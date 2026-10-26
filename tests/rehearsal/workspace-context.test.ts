import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg, { type Pool } from 'pg';
import sharp from 'sharp';
import type { ConnectedWorkspace } from '../../src/ports/connected-workspace.ts';
import { startRehearsalDatabase } from '../support/rehearsal-db.ts';
import { startFakeS3 } from '../support/fake-s3.ts';
import { startWorkerHost } from '../support/worker-host.ts';
import { installFakeProviders } from '../support/fake-providers.ts';
import type { PipelineView } from '../../src/domain/pipeline.ts';
import type { WorkspaceProcessing } from '../../src/domain/workspace-management.ts';
import { currentWorkerContext, runWithWorkerContext } from '../../src/server/worker-context.ts';

const APP='http://127.0.0.1:3997', PILOT='10000000-0000-0000-0000-000000000101';
const OPERATOR={subject:'workspace-operator',email:'operator@context.test',name:'Operator',image:undefined,emailVerified:true};
const EDITOR={subject:'workspace-editor',email:'editor@context.test',name:'Editor',image:undefined,emailVerified:true};
const TEAMMATE={subject:'workspace-teammate',email:'teammate@context.test',name:'Teammate',image:undefined,emailVerified:true};
const OUTSIDER={subject:'workspace-outsider',email:'outsider@context.test',name:'Outsider',image:undefined,emailVerified:true};
let db:Awaited<ReturnType<typeof startRehearsalDatabase>>,handle:typeof import('../../src/server/http.ts').handleReporter,second:string,operatorId:string;
let storage:Awaited<ReturnType<typeof startFakeS3>>,host:Awaited<ReturnType<typeof startWorkerHost>>;
async function owner(sql:string,values:unknown[]=[]) {
  const client=new pg.Client({connectionString:db.owner});await client.connect();
  try{return(await client.query(sql,values)).rows;}finally{await client.end();}
}
async function api<T=Record<string,unknown>>(path:string,body?:unknown,identity:typeof OPERATOR|null=EDITOR) {
  const raw=body instanceof Blob;
  const request=new Request(`${APP}/api/reporter/${path}`,body===undefined?undefined:{method:'POST',headers:{origin:APP,'content-type':raw?body.type:'application/json','idempotency-key':randomUUID()},body:raw?body:JSON.stringify(body)});
  const response=await handle(request,path.split('?')[0].split('/'),{identify:async()=>identity,defer:()=>{}});
  return{status:response.status,body:await response.json() as T};
}
before(async()=>{
  db=await startRehearsalDatabase([{email:OPERATOR.email,role:'admin'},{email:EDITOR.email,role:'editor'},{email:TEAMMATE.email,role:'editor'},{email:OUTSIDER.email,role:'editor'}]);
  for(const person of [OPERATOR,EDITOR,TEAMMATE,OUTSIDER]) await owner('UPDATE core.users SET auth_subject=$2,email_verified=true WHERE email=$1',[person.email,person.subject]);
  await owner("UPDATE public.portal_members SET status='disabled' WHERE user_id=(SELECT id FROM core.users WHERE email=$1)",[OUTSIDER.email]);
  [{id:operatorId}]=await owner('SELECT id FROM core.users WHERE email=$1',[OPERATOR.email]);
  await owner("INSERT INTO public.user_roles(user_id,role) VALUES($1,'platform_admin')",[operatorId]);
  Object.assign(process.env,{REPORTER_DEPLOYMENT_MODE:'cloud',REPORTER_DATABASE_URL:db.runtime,REPORTER_WORKER_DATABASE_URL:db.worker,
    REPORTER_DEFAULT_PORTAL_ID:PILOT,REPORTER_WORKSPACES_MODE:'all',REPORTER_WORKER_PASSWORD:db.workerPassword,REPORTER_APP_ORIGINS:APP});
  storage=await startFakeS3({bucket:'reporter-source-media',corsOrigins:[APP]});
  Object.assign(process.env,{AWS_ENDPOINT_URL_S3:storage.endpoint,AWS_REGION:'us-east-1',AWS_ACCESS_KEY_ID:'synthetic-access-key',AWS_SECRET_ACCESS_KEY:'synthetic-secret-key'});
  ({handleReporter:handle}=await import('../../src/server/http.ts'));
  const {createReporterWorker}=await import('../../functions/reporter-worker.ts');
  host=await startWorkerHost(createReporterWorker());process.env.REPORTER_WORKER_URL=host.url;
  const created=await api<{id:string;revision:number}>('platform/workspaces',{name:'Second client',slug:'second-context'},OPERATOR);
  assert.equal(created.status,201);second=created.body.id;
  await api(`platform/workspaces/${second}/update`,{name:'Second client',status:'active',revision:created.body.revision},OPERATOR);
  await api('platform/invites',{name:EDITOR.name,email:EDITOR.email,role:'approver',workspaceId:second},OPERATOR);
  const [{token_hash:hash}]=await owner('SELECT token_hash FROM core.access_invites WHERE portal_id=$1',[second]);
  await owner('SELECT public.reporter_invite_accept($1,$2)',[hash,EDITOR.subject]);
},{timeout:180000});
after(async()=>{
  await host?.stop();await storage?.stop();
  const pools=(globalThis as typeof globalThis & {reporterPools?:Partial<Record<string,Pool>>}).reporterPools??{};
  await Promise.all(Object.values(pools).map(pool=>pool?.end()));db?.stop();
});

test('private image IDs, signed upload completion and actual bytes stay with their addressed workspace',async()=>{
  const photo=await sharp({create:{width:16,height:16,channels:3,background:'#204060'}}).png().toBuffer();
  const production=await api<{value:{productionId:string}}>('w/second-context/workspace',{method:'createBlank',args:[{title:'Asset owner',brief:{size:'standard',sections:3}}],requestId:randomUUID()},OPERATOR);
  const id=randomUUID(),hash=createHash('sha256').update(photo).digest('hex');
  const prepared=await api<{url:string;token:string}>('w/second-context/visuals/assets/prepare',{id,fileName:'photo.png',mime:'image/png',size:photo.length,hash,meta:{productionId:production.body.value.productionId,authorized:true}},OPERATOR);
  assert.equal(prepared.status,200);
  assert.ok(new URL(prepared.body.url).pathname.includes(`images/${second}/`));
  assert.equal((await fetch(prepared.body.url,{method:'PUT',headers:{'content-type':'image/png'},body:photo})).status,200);
  assert.equal((await api('w/reporter-ai/visuals/assets/complete',{token:prepared.body.token},OPERATOR)).status,403);
  assert.equal((await api('w/second-context/visuals/assets/complete',{token:prepared.body.token},OPERATOR)).status,200);
  const binary=async(slug:string,identity:typeof OPERATOR)=>handle(new Request(`${APP}/api/reporter/w/${slug}/visuals/assets/${id}/file`),['w',slug,'visuals','assets',id,'file'],{identify:async()=>identity,defer:()=>{}});
  assert.equal((await binary('reporter-ai',OPERATOR)).status,404);
  assert.equal((await binary('second-context',TEAMMATE)).status,404);
  const own=await binary('second-context',EDITOR);assert.equal(own.status,200);
  assert.deepEqual(Buffer.from(await own.arrayBuffer()),photo);
  const other=await sharp({create:{width:16,height:16,channels:3,background:'#804020'}}).png().toBuffer();
  const firstProduction=await api<{value:{productionId:string}}>('w/reporter-ai/workspace',{method:'createBlank',args:[{title:'Other asset owner',brief:{size:'standard',sections:3}}],requestId:randomUUID()},OPERATOR);
  const firstUpload=await api<{url:string;token:string}>('w/reporter-ai/visuals/assets/prepare',{id,fileName:'other.png',mime:'image/png',size:other.length,
    hash:createHash('sha256').update(other).digest('hex'),meta:{productionId:firstProduction.body.value.productionId,authorized:true}},OPERATOR);
  await fetch(firstUpload.body.url,{method:'PUT',headers:{'content-type':'image/png'},body:other});
  assert.equal((await api('w/reporter-ai/visuals/assets/complete',{token:firstUpload.body.token},OPERATOR)).status,200);
  assert.deepEqual(Buffer.from(await(await binary('reporter-ai',OPERATOR)).arrayBuffer()),other);
  assert.deepEqual(Buffer.from(await(await binary('second-context',EDITOR)).arrayBuffer()),photo,'an identical asset ID in another client cannot replace these bytes');
  const mismatch=await fetch(host.url+'/objects',{method:'POST',headers:{'content-type':'application/json','x-reporter-worker-key':db.workerPassword},body:JSON.stringify({action:'read',portal:PILOT,key:`images/${second}/${hash}.image`})});
  assert.equal(mismatch.status,403);
});

test('the account avatar follows its owner across clients without granting access to client files',async()=>{
  const photo=await sharp({create:{width:20,height:20,channels:3,background:'#315b80'}}).png().toBuffer();
  const saved=await api<{image:string}>('w/second-context/profile/avatar',new Blob([new Uint8Array(photo)],{type:'image/png'}));
  assert.equal(saved.status,200);assert.match(saved.body.image,/^\/api\/reporter\/avatars\//);
  const path=saved.body.image.slice('/api/reporter/'.length).split('/');
  const image=async(identity:typeof OPERATOR)=>handle(new Request(APP+saved.body.image),path,{identify:async()=>identity,defer:()=>{}});
  assert.equal((await image(EDITOR)).status,200);
  assert.equal((await image(TEAMMATE)).status,200,'a teammate can see the shared account photo stored from another client');
  assert.equal((await image(OUTSIDER)).status,404);
  assert.equal((await api('w/second-context/workspace',undefined,TEAMMATE)).status,404);
});

test('a queued request cannot be accepted as a different signed-in account',async()=>{
  const response=await handle(new Request(`${APP}/api/reporter/w/reporter-ai/workspace`,{method:'POST',headers:{origin:APP,'content-type':'application/json','x-reporter-account':operatorId},
    body:JSON.stringify({method:'createBlank',args:[{title:'Wrong actor',brief:{size:'standard',sections:3}}],requestId:randomUUID()})}),['w','reporter-ai','workspace'],{identify:async()=>EDITOR,defer:()=>{}});
  assert.equal(response.status,409);assert.equal((await response.json()).error,'ACCOUNT_CONTEXT_CHANGED');
});

test('one account resolves independent roles; a platform operator enters as the real administrator',async()=>{
  const a=await api<ConnectedWorkspace>('w/reporter-ai/workspace');
  const b=await api<ConnectedWorkspace>('w/second-context/workspace');
  assert.equal(a.status,200);assert.equal(b.status,200);
  assert.equal(a.body.state.workspace.id,PILOT);assert.equal(b.body.state.workspace.id,second);
  assert.deepEqual(a.body.state.members.find(m=>m.personId===a.body.state.sessionPersonId)?.roles,['editor']);
  assert.deepEqual(b.body.state.members.find(m=>m.personId===b.body.state.sessionPersonId)?.roles,['approver']);
  const admin=await api<ConnectedWorkspace>('w/second-context/workspace',undefined,OPERATOR);
  assert.equal(admin.status,200);assert.equal(admin.body.state.sessionPersonId,operatorId);
  assert.deepEqual(admin.body.state.members.find(m=>m.personId===operatorId)?.roles,['admin']);
  assert.notEqual(a.body.syncToken,b.body.syncToken);
  const foreignCursor=await api<ConnectedWorkspace>(`w/second-context/workspace?since=${encodeURIComponent(a.body.syncToken!)}`);
  assert.equal(foreignCursor.body.state.workspace.id,second);
});

test('identical retry keys remain scoped; role carryover and foreign production writes are refused',async()=>{
  const requestId=randomUUID();
  const command={method:'createBlank',args:[{title:'Independent draft',brief:{size:'standard',sections:3}}],requestId};
  const a=await api<{ok:boolean;value:{productionId:string}}>('w/reporter-ai/workspace',command);
  assert.equal(a.body.ok,true);
  const refused=await api<{ok:boolean}>('w/second-context/workspace',command);
  assert.equal(refused.status,403);
  const b=await api<{ok:boolean;value:{productionId:string}}>('w/second-context/workspace',command,OPERATOR);
  assert.equal(b.body.ok,true);assert.notEqual(a.body.value.productionId,b.body.value.productionId);
  const retry=await api<typeof a.body>('w/reporter-ai/workspace',command);
  assert.equal(retry.body.value.productionId,a.body.value.productionId);
  const foreign=await api<{ok:boolean}>('w/second-context/workspace',{method:'rename',args:[a.body.value.productionId,'Wrong destination'],requestId:randomUUID()},OPERATOR);
  assert.equal(foreign.body.ok,false);
  const rows=await owner('SELECT portal_id,doc->>\'createdBy\' AS actor FROM public.reporter_ed_productions WHERE production_id=$1',[b.body.value.productionId]);
  assert.deepEqual(rows,[{portal_id:second,actor:operatorId}]);
});

test('missing, invalid and disabled contexts fail closed while legacy links retain only the pilot',async()=>{
  assert.equal((await api('w/nonexistent-client/workspace')).status,404);
  assert.equal((await api('w/second-context/platform/directory',undefined,OPERATOR)).status,404);
  assert.equal((await api('w/second-context/workspace',undefined,null)).status,401);
  try{
    process.env.REPORTER_WORKSPACES_MODE='admin';
    assert.equal((await api('w/second-context/workspace')).status,403);
    assert.equal((await api('workspaces')).status,403);
    assert.equal((await api('w/second-context/workspace',undefined,OPERATOR)).status,200);
    process.env.REPORTER_WORKSPACES_MODE='off';
    assert.equal((await api('w/second-context/workspace',undefined,OPERATOR)).status,403);
    const legacy=await api<ConnectedWorkspace>('workspace');assert.equal(legacy.body.state.workspace.id,PILOT);
  }finally{process.env.REPORTER_WORKSPACES_MODE='all';}
});

test('membership revocation is effective on the next request without disabling another client',async()=>{
  await owner("UPDATE public.portal_members SET status='disabled' WHERE portal_id=$1 AND user_id=(SELECT id FROM core.users WHERE email=$2)",[PILOT,EDITOR.email]);
  assert.equal((await api('w/reporter-ai/workspace')).status,404);
  assert.equal((await api('w/second-context/workspace')).status,200);
  const directory=await api<{items:{workspace:{id:string}}[]}>('workspaces');
  assert.deepEqual(directory.body.items.map(item=>item.workspace.id),[second]);
});

test('original upload callbacks derive the client from registration and tokens, independent of the visible page',async()=>{
  const {startCloudUpload,completeCloudUpload,finalizeUploadedObject,signedSourceUrl}=await import('../../src/server/cloud-storage.ts');
  const sourceId=randomUUID(),token=randomUUID()+randomUUID(),bytes=Buffer.from('synthetic original');
  const prepared=await api<{id:string}>('w/second-context/uploads',{sourceId,token,name:'recording.mp3',size:bytes.length},OPERATOR);
  assert.equal(prepared.status,202);
  await assert.rejects(startCloudUpload(sourceId,randomUUID()+randomUUID()),{code:'42501'});
  const session=await startCloudUpload(sourceId,token);
  assert.ok(new URL(session.parts[0].url).pathname.includes(`incoming/${second}/${sourceId}.mp3`));
  assert.equal((await fetch(session.parts[0].url,{method:'PUT',body:bytes})).status,200);
  await api('w/reporter-ai/workspace',undefined,OPERATOR);
  const first=await completeCloudUpload(sourceId,token);
  assert.equal(first.sourceId,sourceId);
  const key=`incoming/${second}/${sourceId}.mp3`;
  assert.equal((await finalizeUploadedObject('reporter-source-media',key)).id,prepared.body.id,'a repeated storage callback queues no duplicate');
  const [row]=await owner("SELECT o.portal_id,o.tenant_id,s.owner_user_id,o.payload->>'entity_type' AS kind FROM core.integration_outbox o JOIN core.storage_objects s ON s.id=$1 WHERE o.aggregate_id=$2 AND o.event_type='reporter.transcription.requested'",[sourceId,prepared.body.id]);
  assert.equal(row.portal_id,second);assert.equal(row.owner_user_id,operatorId);assert.equal(row.kind,'transcript');
  await runWithWorkerContext({tenant:row.tenant_id,portal:second,actor:operatorId},async()=>{
    const url=await signedSourceUrl('reporter-source-media',key);
    assert.deepEqual(Buffer.from(await(await fetch(url)).arrayBuffer()),bytes);
    await assert.rejects(finalizeUploadedObject('reporter-source-media',`incoming/${PILOT}/${sourceId}.mp3`),{code:'42501'});
  });
  const [{tenant_id:tenant}]=await owner('SELECT tenant_id FROM public.portals WHERE id=$1',[PILOT]);
  await runWithWorkerContext({tenant,portal:PILOT,actor:operatorId},async()=>{
    await assert.rejects(signedSourceUrl('reporter-source-media',key),{code:'SOURCE_UNAVAILABLE'});
    await assert.rejects(finalizeUploadedObject('reporter-source-media',key),{code:'WORKER_CONTEXT_CHANGED'});
  });
});

test('two simultaneous generations retain their enqueue identity, workspace, configuration and usage while pages switch',{timeout:30000},async()=>{
  process.env.GROQ_API_KEY='synthetic-placeholder';
  const rpc=async<T>(slug:string,method:string,args:unknown[])=>{
    const response=await api<{ok:boolean;value:T}>(`w/${slug}/workspace`,{method,args,requestId:randomUUID()},OPERATOR);
    assert.equal(response.body.ok,true,JSON.stringify(response.body));return response.body.value;
  };
  const jobs:Array<{slug:string;portal:string;runId:string;productionId:string;hash:string}>=[];
  for(const [slug,portal] of [['reporter-ai',PILOT],['second-context',second]]){
    const pipeline=await api<PipelineView>(`w/${slug}/pipeline`,undefined,OPERATOR);
    const definition=structuredClone(pipeline.body.active.definition);definition.curateQuotes=false;
    const saved=await rpc<PipelineView>(slug,'pipeline.save',[definition,pipeline.body.active.revision]);
    const production=await rpc<{productionId:string}>(slug,'createFromSource',[{title:`Owned by ${slug}`,plan:['article'],brief:{sections:2,size:'standard'},
      material:{text:['A fonte confirmou um teste de rastreabilidade e explicou como os registros devem preservar a origem de cada material.',
        'Outra fonte descreveu os próximos passos do teste e destacou a importância de conferir o resultado com os documentos de origem.',
        'A equipe informou que a revisão humana continua sendo uma etapa necessária antes da aprovação de qualquer conteúdo produzido.',
        'Os responsáveis explicaram que cada cliente usa suas próprias orientações editoriais e acompanha as tarefas em seu espaço de trabalho.'].join('\n\n'),origin:'podcast',authorized:true}}]);
    const snapshot=await api<ConnectedWorkspace>(`w/${slug}/workspace`,undefined,OPERATOR);
    const piece=snapshot.body.state.productions.find(item=>item.production.id===production.productionId)!.pieces[0];
    const started=await rpc<{runId:string}>(slug,'generation.start',['article.outline',{productionId:production.productionId,pieceId:piece.id}]);
    jobs.push({slug,portal,runId:started.runId,productionId:production.productionId,hash:saved.active.hash});
  }
  const providers=installFakeProviders(),fake=globalThis.fetch,seen=new Set<string>();
  const both=Promise.withResolvers<void>();
  globalThis.fetch=async(input,init)=>{
    if(String(input).startsWith('https://api.groq.com/')){
      const context=currentWorkerContext()!;assert.equal(context.actor,operatorId);
      assert.equal(context.job?.id,jobs.find(job=>job.portal===context.portal)!.runId);
      seen.add(context.portal);if(seen.size===2)both.resolve();await both.promise;
    }
    return fake(input,init);
  };
  try{
    const {runEditorialJob}=await import('../../src/server/editorial-worker.ts');
    const tasks=Promise.all([runEditorialJob('concurrent-worker-a',new AbortController().signal),runEditorialJob('concurrent-worker-b',new AbortController().signal)]);
    await both.promise;
    await api('w/second-context/workspace',undefined,OPERATOR);await api('w/reporter-ai/workspace',undefined,OPERATOR);
    assert.deepEqual(await tasks,[true,true]);assert.equal(seen.size,2);
    for(const job of jobs){
      const [{portal_id,context,hash,fold}]=await owner("SELECT portal_id,job->'context' AS context,job->>'pipelineHash' AS hash,fold FROM public.reporter_ed_runs WHERE run_id=$1",[job.runId]);
      assert.equal(portal_id,job.portal);assert.deepEqual(context,{tenant:(await owner('SELECT tenant_id FROM public.portals WHERE id=$1',[job.portal]))[0].tenant_id,workspace:job.portal,actor:operatorId});
      assert.equal(hash,job.hash);assert.equal(fold.run.status,'completed',JSON.stringify(fold.run.error));assert.ok(fold.run.usage.totalTokens>0);
      const other=jobs.find(item=>item!==job)!;
      assert.equal((await owner('SELECT count(*)::int AS count FROM public.reporter_ed_runs WHERE portal_id=$1 AND run_id=$2',[other.portal,job.runId]))[0].count,0);
    }
    globalThis.fetch=fake;
    for(const job of jobs){
      const snapshot=await api<ConnectedWorkspace>(`w/${job.slug}/workspace`,undefined,OPERATOR);
      const piece=snapshot.body.state.productions.find(item=>item.production.id===job.productionId)!.pieces[0];
      const started=await rpc<{runId:string}>(job.slug,'generation.start',['article.outline',{productionId:job.productionId,pieceId:piece.id}]);
      await owner("UPDATE public.reporter_ed_runs SET job=job-'context' WHERE run_id=$1",[started.runId]);
      const calls=providers.calls.completions;
      assert.equal(await runEditorialJob('legacy-context-worker',new AbortController().signal),true);
      const [{fold}]=await owner('SELECT fold FROM public.reporter_ed_runs WHERE run_id=$1',[started.runId]);
      if(job.portal===PILOT) assert.equal(fold.run.status,'completed','historical pilot jobs remain compatible');
      else {assert.equal(fold.run.error.code,'JOB_CONTEXT_MISMATCH');assert.equal(providers.calls.completions,calls,'missing ownership is refused before spending provider requests');}
    }
  }finally{providers.restore();delete process.env.GROQ_API_KEY;}
});

test('processing policy is visible only in the addressed client and saves with an optimistic revision',async()=>{
  const path=`platform/workspaces/${second}/processing`;
  const current=await api<WorkspaceProcessing>(path,undefined,OPERATOR);assert.equal(current.status,200);assert.ok(current.body.usedToday>0);
  const limited=await api<WorkspaceProcessing>(path,{revision:current.body.revision,dailyLimit:1},OPERATOR);
  assert.equal(limited.status,200);assert.equal(limited.body.state,'limited');
  assert.equal((await api<WorkspaceProcessing>('w/second-context/processing')).body.state,'limited');
  assert.equal((await api<WorkspaceProcessing>('w/reporter-ai/processing',undefined,OPERATOR)).body.state,'ready');
  assert.equal((await api(path,{revision:current.body.revision,dailyLimit:null},OPERATOR)).status,409);
  assert.equal((await api(path,{revision:limited.body.revision,dailyLimit:null})).status,403);
  assert.equal((await api('w/second-context/processing',undefined,OUTSIDER)).status,404);
  assert.equal((await api<WorkspaceProcessing>(path,{revision:limited.body.revision,dailyLimit:null},OPERATOR)).body.state,'ready');
});

test('automated feeds, complementary search and translation claims retain the configuring account in each client',async()=>{
  const {resolveReporterContext,transaction}=await import('../../src/server/database.ts');
  const {runWithReporterContext}=await import('../../src/server/request-context.ts');
  const {runNewsSource}=await import('../../src/server/news-reader.ts');
  const contexts=[];
  for(const slug of ['reporter-ai','second-context']){
    const context=(await resolveReporterContext(OPERATOR,slug))!;contexts.push(context);
    await runWithReporterContext(context,()=>transaction('runtime',async client=>{
      await client.query('SELECT public.reporter_news_source_add($1,$2,$3,$3,$4,$5,$6,$7)',
        ['rss',slug,`https://feed-${slug}.example.test/rss`,60,null,null,null]);
      const config={portalUrl:`https://${slug}.test`,sector:slug,region:'Brasil',topics:['Tecnologia'],languages:['pt'],excludedDomains:[],everyMinutes:60,dailyLimit:1,enabled:true};
      await client.query('SELECT public.reporter_news_search_save($1,$2,$3)',[0,JSON.stringify(config),[`${slug}.test`]]);
    }));
  }
  const seen=new Set<string>();
  for(let i=0;i<2;i++) assert.equal(await runNewsSource('feed-ownership-worker',new AbortController().signal,{now:Date.now,fetch:async(url)=>{
    const context=currentWorkerContext()!;assert.equal(context.actor,operatorId);seen.add(context.portal);
    return {status:200,url,contentType:'application/rss+xml',text:`<rss version="2.0"><channel><title>Teste</title><item><guid>${context.portal}</guid><title>Teste de origem do material</title><link>https://source.example.test/${context.portal}</link><pubDate>${new Date().toUTCString()}</pubDate><description>Material recebido no cliente correto.</description></item></channel></rss>`};
  }}),true);
  assert.equal(seen.size,2);
  for(const context of contexts){
    const [item]=await owner('SELECT id,imported_by FROM public.reporter_news_items WHERE portal_id=$1',[context.portal]);
    assert.equal(item.imported_by,operatorId);
    await runWithWorkerContext({tenant:context.tenant,portal:context.portal},()=>transaction('worker',async client=>{
      const search=(await client.query('SELECT public.reporter_news_search_claim($1) AS value',['source-context-worker'])).rows[0].value;
      assert.equal(search.actor,operatorId);assert.equal(search.config.sector,context.workspaceSlug);
      const translation=(await client.query('SELECT public.reporter_news_translation_claim($1,$2) AS value',['translation-context-worker',120000])).rows[0].value;
      assert.equal(translation.actor,operatorId);assert.equal(translation.id,item.id);
    }));
  }
});
