import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';
import {assertStagingTarget,acceptanceOrigin} from './lib/staging-target.mjs';
import {createEditorialEngine,editorialCandidates} from '../src/runtime/editorial-engine.ts';
import {workspaceTemplateLibrary} from '../src/runtime/workspace-templates.ts';
import {plannedLayouts} from '../src/domain/carousel.ts';
import {latestApproved} from '../src/domain/record.ts';
import {assignedTemplateIds} from '../src/domain/workspace-templates.ts';
import {defaultEditorialPolicy} from '../src/domain/editorial-policy.ts';
import {validateExport} from './neon-render-acceptance.mjs';
import {runWithReporterContext} from '../src/server/request-context.ts';
import {resolveReporterContext,pool} from '../src/server/database.ts';
import {handleReporter} from '../src/server/http.ts';

const PILOT='10000000-0000-0000-0000-000000000101';
const quotes=['A revisão humana faz parte de cada etapa.','A previsão depende de testes reais.','Ainda não temos um calendário definido.'];
const passages=quotes.map(quote=>'A equipe avalia os dados da fonte e mantém o plano em teste. '.repeat(14)+' A fonte afirma: “'+quote+'”');
const source=passages.join('\n\n');

/** Real staging SQL, HTTP business handlers, storage and browser downloads; no AI requests.
 * Identities are synthetic at the verified-session boundary, as in the core acceptance.
 * The separately recorded single live-model QA remains separate from this release check.
 */
export async function acceptWorkspaceFlow(environment=process.env,request=fetch){
  const branch=await assertStagingTarget(environment,request);
  assert.equal(branch.id,environment.NEON_BRANCH_ID,'Staging branch response mismatch');
  const connection=new URL(environment.DATABASE_URL_UNPOOLED);
  const endpoints=await request(`https://console.neon.tech/api/v2/projects/${encodeURIComponent(environment.NEON_PROJECT_ID)}/endpoints`,{
    headers:{Authorization:'Bearer '+environment.NEON_API_KEY},signal:AbortSignal.timeout(30000)});
  assert.equal(endpoints.ok,true,'Cannot verify the staging database endpoint');
  const endpoint=(await endpoints.json()).endpoints.find(item=>item.host===connection.hostname||item.id===connection.hostname.split('.')[0].replace(/-pooler$/,''));
  assert.equal(endpoint?.branch_id,branch.id,'Acceptance refuses a database outside the verified staging branch');
  const owner=new pg.Client({connectionString:connection.toString()});await owner.connect();
  const actors=[],clients=[],origin=acceptanceOrigin(environment),suffix=randomUUID().slice(0,8);
  let activation;
  const originalFetch=globalThis.fetch;
  // Any accidental provider call fails before it leaves this acceptance process.
  globalThis.fetch=(input,init)=>{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    if(['api.groq.com','api.openai.com','api.anthropic.com','generativelanguage.googleapis.com','api.tavily.com'].includes(url.hostname))
      throw new Error('Workspace acceptance forbids provider calls');
    return originalFetch(input,init);
  };
  async function call(actor,path,body){
    const response=await handleReporter(new Request(origin+'/api/reporter/'+path,{method:body===undefined?'GET':'POST',
      headers:{origin,'x-reporter-account':actor.id,'content-type':body instanceof Blob?body.type:'application/json'},
      ...(body===undefined?{}:{body:body instanceof Blob?body:JSON.stringify(body)})}),path.split('?')[0].split('/'),{
      identify:async()=>actor,defer:()=>{},
    });
    const content=await response.text();return{status:response.status,value:JSON.parse(content)};
  }
  async function ok(actor,path,body,status=200){const result=await call(actor,path,body);assert.equal(result.status,status,result.value.error??result.value.refusal?.code??'Unexpected HTTP status');return result.value;}
  async function rpc(actor,client,method,...args){const result=await ok(actor,`w/${client.slug}/workspace`,{method,args,requestId:randomUUID()});assert.equal(result.ok,true,JSON.stringify(result));return result.value;}
  const snapshot=(actor,client)=>ok(actor,`w/${client.slug}/workspace`);
  async function record(actor,client,id){const engine=createEditorialEngine(await snapshot(actor,client),{next:()=>randomUUID()});try{return engine.records.record(id);}finally{engine.store.dispose();}}
  const pilotFingerprint=async()=>(await owner.query(`SELECT p.id,p.tenant_id,p.slug,p.name,
    (SELECT md5(string_agg(doc::text,'' ORDER BY hash)) FROM public.reporter_ed_pipelines WHERE portal_id=p.id) AS pipelines,
    (SELECT count(*)::integer FROM public.reporter_ed_productions WHERE portal_id=p.id) AS productions,
    (SELECT count(*)::integer FROM public.portal_members WHERE portal_id=p.id) AS members
    FROM public.portals p WHERE p.id=$1`,[PILOT])).rows;
  try{
    const before=await pilotFingerprint();
    for(const name of ['operator','editor-a','reviewer-a','editor-b','reviewer-b']){
      const id=randomUUID(),subject='staging-qa-'+randomUUID(),email=`workspace-${suffix}-${name}@acceptance.invalid`;
      await owner.query('INSERT INTO core.users(id,name,email,auth_subject,email_verified) VALUES($1,$2,$3,$4,true)',[id,'Workspace QA '+name,email,subject]);
      actors.push({id,subject,email,name:'Workspace QA '+name,emailVerified:true,sessionId:randomUUID()});
    }
    const operator=actors[0];
    await owner.query("INSERT INTO public.user_roles(user_id,role) VALUES($1,'platform_admin')",[operator.id]);
    activation=await ok(operator,'platform/workspace-activation');
    if(activation.mode!=='all')await ok(operator,'platform/workspace-activation',{mode:'all',revision:activation.revision});
    for(const[index,label]of ['Alpha','Beta'].entries()){
      const editor=actors[index*2+1],reviewer=actors[index*2+2];
      const client=await ok(operator,'platform/workspaces',{name:'Staging QA '+label+' '+suffix,slug:`qa-${suffix}-${label.toLowerCase()}`},201);clients.push(client);
      for(const[actor,role]of [[editor,'editor'],[reviewer,'approver']]){
        const invite=await ok(operator,'platform/invites',{name:actor.name,email:actor.email,role,workspaceId:client.id});
        await owner.query('SELECT public.reporter_invite_accept($1,$2)',[createHash('sha256').update(invite.token).digest('hex'),actor.subject]);
      }
      const members=await ok(operator,`platform/workspaces/${client.id}/team`),member=members.items.find(item=>item.personId===reviewer.id);
      await ok(operator,`platform/workspaces/${client.id}/members/${reviewer.id}`,{revision:member.revision,roles:['approver','creative_reviewer']});
      const pipeline=await ok(operator,`w/${client.slug}/pipeline`),definition=structuredClone(pipeline.active.definition);
      definition.editorial=defaultEditorialPolicy();definition.editorial.map.audience='Staging audience '+label;definition.editorial.guide.voice='Staging voice '+label;
      await rpc(operator,client,'pipeline.save',definition,pipeline.active.revision);
      const color=index?{r:32,g:92,b:200}:{r:208,g:48,b:48};
      const logo=await sharp({create:{width:32,height:32,channels:4,background:{...color,alpha:1}}}).png().toBuffer();
      const brand=await ok(operator,`platform/workspaces/${client.id}/logo`,new Blob([logo],{type:'image/png'}),201);
      let metadata=await ok(operator,`platform/workspaces/${client.id}`);
      await ok(operator,`platform/workspaces/${client.id}/templates`,{revision:metadata.revision,config:{publication:client.name,presets:['editorial'],defaultPreset:'editorial',font:'Inter',logoId:brand.id}});
      metadata=await ok(operator,`platform/workspaces/${client.id}`);
      await ok(operator,`platform/workspaces/${client.id}/update`,{revision:metadata.revision,name:client.name,status:'active'});
      const created=await rpc(editor,client,'createFromSource',{title:client.name+' — cobertura de teste',material:{text:source,format:'auto',origin:'event',authorized:true},brief:{sections:2,size:'standard'},plan:['article','carousel']});
      let current=await record(editor,client,created.productionId),piece=current.pieces.find(item=>item.kind==='article');
      const evidence=quotes.map(quote=>{const candidate=editorialCandidates(current).find(candidate=>candidate.text.includes(quote));assert.ok(candidate);return candidate;});
      await rpc(editor,client,'saveDraft',piece.id,{type:'article',title:client.name+' — cobertura de teste',blocks:passages.map((text,index)=>({id:randomUUID(),type:'paragraph',inlines:[{text}],sourceRefs:[evidence[index].ref]}))},piece.draft.revision);
      async function approve(pieceId){const sent=await rpc(editor,client,'requestReview',pieceId,{assigneeId:reviewer.id});
        assert.equal((await call(editor,`w/${client.slug}/workspace`,{method:'decide',args:[{pieceId,subject:sent.request.subject,decision:'approved',displayedHash:sent.request.subject.hash}],requestId:randomUUID()})).status,403);
        await rpc(reviewer,client,'decide',{pieceId,subject:sent.request.subject,decision:'approved',displayedHash:sent.request.subject.hash});return sent.request.subject;}
      const approved=await approve(piece.id),state=await snapshot(editor,client),templateId=assignedTemplateIds(state.templateConfiguration.active)[0];
      await rpc(editor,client,'derive',{productionId:created.productionId,kind:'carousel',from:approved,templateId,rebase:true});
      current=await record(editor,client,created.productionId);piece=current.pieces.find(item=>item.kind==='carousel');
      const template=workspaceTemplateLibrary(state.templateConfiguration).templates.find(item=>item.id===templateId);assert.ok(template);
      const article=latestApproved(current,current.pieces.find(item=>item.kind==='article').id).version.body;
      const slides=plannedLayouts(template,3).map(layout=>({id:randomUUID(),layout:layout.id,sourceBlockIds:[article.blocks[0].id],slots:Object.fromEntries(layout.slots.map(slot=>[slot.id,(slot.role==='body'?'A equipe mantém o plano em teste.':slot.role==='title'?'Cobertura de teste':label).slice(0,slot.maxChars)]))}));
      await rpc(editor,client,'saveDraft',piece.id,{type:'carousel',templateId,slides},piece.draft.revision);await approve(piece.id);
      const context=await resolveReporterContext(editor,client.slug);assert.ok(context);
      const finalSnapshot=await snapshot(editor,client);
      const exported=await runWithReporterContext(context,()=>validateExport(finalSnapshot,created.productionId));
      await rpc(editor,client,'recordDelivery',{productionId:created.productionId,selection:exported.selection,mode:'download',files:exported.outcomes});
      assert.equal((await record(editor,client,created.productionId)).deliveries.length,1);
      const other=actors[(1-index)*2+1];assert.equal((await call(other,`w/${client.slug}/workspace`)).status,404);
      console.log(`PASS staging client ${label}: invitation, policy, brand, separate approvals, browser export and foreign-context refusal; zero provider calls.`);
    }
    assert.deepEqual(await pilotFingerprint(),before,'Staging acceptance changed the preserved pilot');
  }finally{
    try{
      for(const client of clients){const metadata=await ok(actors[0],`platform/workspaces/${client.id}`);await ok(actors[0],`platform/workspaces/${client.id}/update`,{revision:metadata.revision,name:client.name,status:'archived'});}
      if(activation){const current=await ok(actors[0],'platform/workspace-activation');if(current.mode!==activation.mode)await ok(actors[0],'platform/workspace-activation',{mode:activation.mode,revision:current.revision});}
    }finally{
      if(actors[0])await owner.query("DELETE FROM public.user_roles WHERE user_id=$1 AND role='platform_admin'",[actors[0].id]);
      await owner.end();globalThis.fetch=originalFetch;
    }
  }
}

if(process.argv[1]?.endsWith('/neon-workspace-acceptance.mjs')||process.argv[1]==='scripts/neon-workspace-acceptance.mjs'){
  try{await acceptWorkspaceFlow();console.log('PASS staging workspace acceptance; synthetic identity boundary, no paid generation.');}
  finally{await Promise.all(['runtime','worker'].map(role=>pool(role).end()));}
}
