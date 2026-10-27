import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import pg,{type Pool} from 'pg';
import sharp from 'sharp';
import type {Role} from '../../src/domain/workspace.ts';
import type {ConnectedWorkspace} from '../../src/ports/connected-workspace.ts';
import type {PipelineView} from '../../src/domain/pipeline.ts';
import {defaultEditorialPolicy} from '../../src/domain/editorial-policy.ts';
import {startRehearsalDatabase} from './rehearsal-db.ts';
import {startFakeS3} from './fake-s3.ts';
import {startWorkerHost} from './worker-host.ts';
import {installFakeProviders} from './fake-providers.ts';

export const TEST_SESSION_HEADER='x-reporter-acceptance-session';
export const PILOT='10000000-0000-0000-0000-000000000101';
export type ScenarioActor={id:string;token:string;subject:string;email:string;name:string;image:undefined;emailVerified:true;sessionId:string};
export const SCENARIO_SOURCE=[
  'A fonte confirmou um teste de rastreabilidade e explicou como os registros devem preservar a origem de cada material.',
  'Outra fonte descreveu os próximos passos do teste e destacou a importância de conferir o resultado com os documentos de origem.',
  'A equipe informou que a revisão humana continua sendo uma etapa necessária antes da aprovação de qualquer conteúdo produzido.',
  'Os responsáveis explicaram que cada cliente usa suas próprias orientações editoriais e acompanha as tarefas em seu espaço de trabalho.',
].join('\n\n');
/** Test-only verified identities, external providers and object storage; business handlers and SQL remain real. */
export async function startWorkspaceScenario(options:{editors?:number;frontendOrigin?:string}={}){
  const count=options.editors??20;
  assert.equal(count%2,0);assert.ok(count>=2&&count<=20);
  const people=[{name:'Scenario operator',role:'admin'},...Array.from({length:count},(_,index)=>({name:`Scenario editor ${index+1}`,role:'editor'})),
    {name:'Scenario reviewer Alpha',role:'approver'},{name:'Scenario reviewer Beta',role:'approver'},{name:'Scenario client administrator',role:'admin'},{name:'Scenario pending member',role:'editor'}];
  const users=people.map((person,index)=>({...person,email:`scenario-${index}@acceptance.invalid`,subject:`scenario-subject-${index}`}));
  const db=await startRehearsalDatabase(users),actors:ScenarioActor[]=[],tokens=new Map<string,ScenarioActor>();
  const owner=async(sql:string,values:unknown[]=[])=>{
    const client=new pg.Client({connectionString:db.owner});await client.connect();
    try{return(await client.query(sql,values)).rows;}finally{await client.end();}
  };
  let worker:Awaited<ReturnType<typeof startWorkerHost>>|undefined,storage:Awaited<ReturnType<typeof startFakeS3>>|undefined;
  const providers=installFakeProviders();
  let held=true,closed=false;
  let handler:typeof import('../../src/server/http.ts').handleReporter;
  const pending=new Set<Promise<unknown>>();
  const server=createServer(async(incoming,outgoing)=>{
    try{
      const chunks:Buffer[]=[];for await(const chunk of incoming)chunks.push(chunk as Buffer);
      const headers=new Headers();for(const[name,value]of Object.entries(incoming.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(', '):value);
      const method=incoming.method??'GET',request=new Request(`${origin}${incoming.url??'/'}`,{method,headers,body:['GET','HEAD'].includes(method)?undefined:Buffer.concat(chunks)});
      const actor=tokens.get(headers.get(TEST_SESSION_HEADER)??'');
      const path=new URL(request.url).pathname;
      let response:Response;
      if(path==='/__acceptance/drain'&&actor?.id===actors[0]?.id){
        held=false;await fetch(worker!.url+'/drain',{method:'POST',headers:{'x-reporter-worker-key':db.workerPassword}});await worker!.idle();response=Response.json({ok:true});
      }else if(path.startsWith('/api/reporter/')){
        response=await handler(request,path.slice('/api/reporter/'.length).split('/'),{identify:async()=>actor??null,defer:task=>{const promise=task();pending.add(promise);void promise.finally(()=>pending.delete(promise)).catch(()=>{});}});
      }else response=Response.json({error:'not_found'},{status:404});
      outgoing.writeHead(response.status,Object.fromEntries(response.headers));outgoing.end(Buffer.from(await response.arrayBuffer()));
    }catch(error){outgoing.writeHead(500);outgoing.end(JSON.stringify({error:error instanceof Error?error.message:'Unexpected test handler error'}));}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`,origin=options.frontendOrigin??base;
  async function call<T=Record<string,unknown>>(actor:ScenarioActor,path:string,body?:unknown){
    const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{origin,[TEST_SESSION_HEADER]:actor.token,'x-reporter-account':actor.id,'content-type':body instanceof Blob?body.type:'application/json'},
      ...(body===undefined?{}:{body:body instanceof Blob?body:JSON.stringify(body)})});
    const text=await response.text();return{status:response.status,bytes:Buffer.byteLength(text),value:JSON.parse(text) as T};
  }
  async function rpc<T>(actor:ScenarioActor,slug:string,method:string,...args:unknown[]):Promise<T>{
    const result=await call<{ok:boolean;value:T;refusal?:unknown}>(actor,`/api/reporter/w/${slug}/workspace`,{method,args,requestId:randomUUID()});
    assert.equal(result.status,200,JSON.stringify(result.value));assert.equal(result.value.ok,true,JSON.stringify(result.value));return result.value.value;
  }
  async function stop(){
    if(closed)return;closed=true;await Promise.allSettled([...pending]);await worker?.idle();
    await new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());});
    await worker?.stop();await storage?.stop();providers.restore();
    await Promise.all(Object.values((globalThis as typeof globalThis&{reporterPools?:Partial<Record<string,Pool>>}).reporterPools??{}).map(pool=>pool?.end()));db.stop();
  }
  try{
    for(const user of users){const[{id}]=await owner('UPDATE core.users SET auth_subject=$2,email_verified=true,name=$3 WHERE email=$1 RETURNING id',[user.email,user.subject,user.name]);
      const actor:ScenarioActor={...user,id,token:randomUUID(),image:undefined,emailVerified:true,sessionId:randomUUID()};actors.push(actor);tokens.set(actor.token,actor);}
    const operator=actors[0],editors=actors.slice(1,count+1),reviewers=actors.slice(count+1,count+3),administrator=actors[count+3],pendingActor=actors[count+4];
    await owner("INSERT INTO public.user_roles(user_id,role) VALUES($1,'platform_admin')",[operator.id]);
    await owner('DELETE FROM public.portal_user_roles WHERE portal_id=$1 AND user_id<>$2',[PILOT,operator.id]);
    await owner('DELETE FROM public.portal_members WHERE portal_id=$1 AND user_id<>$2',[PILOT,operator.id]);
    storage=await startFakeS3({bucket:'reporter-source-media',corsOrigins:[origin,base]});
    Object.assign(process.env,{REPORTER_DEPLOYMENT_MODE:'cloud',REPORTER_DATABASE_URL:db.runtime,REPORTER_WORKER_DATABASE_URL:db.worker,REPORTER_DEFAULT_PORTAL_ID:PILOT,
      REPORTER_WORKSPACES_MODE:'all',REPORTER_WORKER_PASSWORD:db.workerPassword,REPORTER_APP_ORIGINS:origin,GROQ_API_KEY:'synthetic-only',
      AWS_ENDPOINT_URL_S3:storage.endpoint,AWS_REGION:'us-east-1',AWS_ACCESS_KEY_ID:'synthetic-access-key',AWS_SECRET_ACCESS_KEY:'synthetic-secret-key'});
    // The hosted worker uses the local gateway on macOS; /tmp is a symlink, unlike the Linux function runtime.
    delete process.env.REPORTER_FUNCTION_RUNTIME;
    delete process.env.OPENAI_API_KEY;delete process.env.ANTHROPIC_API_KEY;delete process.env.GOOGLE_API_KEY;
    ({handleReporter:handler}=await import('../../src/server/http.ts'));
    const{createReporterWorker}=await import('../../functions/reporter-worker.ts'),actualWorker=createReporterWorker();
    worker=await startWorkerHost({fetch:request=>held&&new URL(request.url).pathname==='/drain'?Promise.resolve(Response.json({accepted:true},{status:202})):actualWorker.fetch(request)});
    process.env.REPORTER_WORKER_URL=worker.url;
    const clients:Array<{id:string;slug:string;name:string;marker:string;color:{r:number;g:number;b:number};templateId:string;pipelineHash:string}>=[];
    async function link(actor:ScenarioActor,workspace:string,roles:Role[]){
      const issued=await call<{token:string}>(operator,'/api/reporter/platform/invites',{name:actor.name,email:actor.email,role:roles[0],workspaceId:workspace});assert.ok(issued.status<300,JSON.stringify(issued.value));
      await owner('SELECT public.reporter_invite_accept($1,$2)',[createHash('sha256').update(issued.value.token).digest('hex'),actor.subject]);
      if(roles.length>1){const page=await call<{items:{personId:string;revision:number}[]}>(operator,`/api/reporter/platform/workspaces/${workspace}/team?search=${encodeURIComponent(actor.email)}`);
        const member=page.value.items.find(person=>person.personId===actor.id)!;
        assert.equal((await call(operator,`/api/reporter/platform/workspaces/${workspace}/members/${actor.id}`,{revision:member.revision,roles})).status,200);}
    }
    for(const[index,label]of['Alpha','Beta'].entries()){
      const created=await call<{id:string;slug:string;name:string;revision:number}>(operator,'/api/reporter/platform/workspaces',{name:`Acceptance publication ${label}`,slug:`acceptance-${label.toLowerCase()}`});assert.equal(created.status,201);
      const client={...created.value,marker:`WORKSPACE_${label.toUpperCase()}_CONTENT`,color:index?{r:32,g:92,b:200}:{r:208,g:48,b:48},templateId:'',pipelineHash:''};
      clients.push(client);
      for(const actor of editors.slice(index*count/2,(index+1)*count/2))await link(actor,client.id,['editor']);
      await link(reviewers[index],client.id,['approver','creative_reviewer']);
      if(index===0)await link(administrator,client.id,['admin']);
      const pipeline=await call<PipelineView>(operator,`/api/reporter/w/${client.slug}/pipeline`),definition=structuredClone(pipeline.value.active.definition);
      definition.curateQuotes=false;definition.articleMode='sequential';delete definition.writing;definition.editorial=defaultEditorialPolicy();
      definition.editorial.map.audience=`Exclusive audience ${label}`;definition.editorial.guide.voice=`Exclusive voice ${label}`;
      client.pipelineHash=(await rpc<PipelineView>(operator,client.slug,'pipeline.save',definition,pipeline.value.active.revision)).active.hash;
      const logo=await sharp({create:{width:32,height:32,channels:4,background:{...client.color,alpha:1}}}).png().toBuffer();
      const uploaded=await call<{id:string}>(operator,`/api/reporter/platform/workspaces/${client.id}/logo`,new Blob([logo],{type:'image/png'}));assert.equal(uploaded.status,201,JSON.stringify(uploaded.value));
      const metadata=await call<{revision:number}>(operator,`/api/reporter/platform/workspaces/${client.id}`);
      const templates=await call<{active:{hash:string}}>(operator,`/api/reporter/platform/workspaces/${client.id}/templates`,{revision:metadata.value.revision,config:{publication:client.name,presets:['editorial'],defaultPreset:'editorial',font:'Inter',logoId:uploaded.value.id}});
      assert.equal(templates.status,200,JSON.stringify(templates.value));
      const current=await call<{revision:number}>(operator,`/api/reporter/platform/workspaces/${client.id}`);
      assert.equal((await call(operator,`/api/reporter/platform/workspaces/${client.id}/update`,{name:client.name,status:'active',revision:current.value.revision})).status,200);
      const snapshot=await call<ConnectedWorkspace>(operator,`/api/reporter/w/${client.slug}/workspace`);
      const {assignedTemplateIds}=await import('../../src/domain/workspace-templates.ts');
      client.templateId=assignedTemplateIds(snapshot.value.templateConfiguration!.active!)[0];
    }
    await link(editors[0],clients[1].id,['approver']);
    return{base,origin,db,owner,operator,editors,reviewers,administrator,pendingActor,clients,call,rpc,providers,
      headers:(actor:ScenarioActor)=>({origin,[TEST_SESSION_HEADER]:actor.token,'x-reporter-account':actor.id}),
      drain:async()=>{const result=await call(operator,'/__acceptance/drain',{});assert.equal(result.status,200,JSON.stringify(result.value));},
      stop};
  }catch(error){await stop();throw error;}
}
