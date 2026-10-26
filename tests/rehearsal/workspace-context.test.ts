import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg, { type Pool } from 'pg';
import sharp from 'sharp';
import type { ConnectedWorkspace } from '../../src/ports/connected-workspace.ts';
import { startRehearsalDatabase } from '../support/rehearsal-db.ts';
import { startFakeS3 } from '../support/fake-s3.ts';
import { startWorkerHost } from '../support/worker-host.ts';

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
  const request=new Request(`${APP}/api/reporter/${path}`,body===undefined?undefined:{method:'POST',headers:{origin:APP,'content-type':raw?body.type:'application/json'},body:raw?body:JSON.stringify(body)});
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
    REPORTER_DEFAULT_PORTAL_ID:PILOT,REPORTER_WORKSPACES_MODE:'all',REPORTER_WORKER_PASSWORD:db.workerPassword});
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
