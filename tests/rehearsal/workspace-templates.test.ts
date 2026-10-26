import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import pg,{type Pool} from 'pg';
import sharp from 'sharp';
import type {WorkspaceBrandAsset,WorkspaceTemplateConfiguration,WorkspaceTemplateInput} from '../../src/domain/workspace-templates.ts';
import {workspaceTemplateLibrary} from '../../src/runtime/workspace-templates.ts';
import {startRehearsalDatabase} from '../support/rehearsal-db.ts';
import {startFakeS3} from '../support/fake-s3.ts';
import {startWorkerHost} from '../support/worker-host.ts';

const APP='http://127.0.0.1:3996',PILOT='10000000-0000-0000-0000-000000000101';
const ADMIN={subject:'template-admin',email:'admin@templates.test',name:'Administrator',image:undefined,emailVerified:true};
const EDITOR={subject:'template-editor',email:'editor@templates.test',name:'Editor',image:undefined,emailVerified:true};
let db:Awaited<ReturnType<typeof startRehearsalDatabase>>,storage:Awaited<ReturnType<typeof startFakeS3>>,host:Awaited<ReturnType<typeof startWorkerHost>>;
let handle:typeof import('../../src/server/http.ts').handleReporter,second:string,adminId:string;
async function owner(sql:string,values:unknown[]=[]){
  const client=new pg.Client({connectionString:db.owner});await client.connect();
  try{return(await client.query(sql,values)).rows;}finally{await client.end();}
}
async function api<T=Record<string,unknown>>(path:string,body?:unknown,identity=ADMIN){
  const raw=body instanceof Blob;
  const response=await handle(new Request(`${APP}/api/reporter/${path}`,body===undefined?undefined:{method:'POST',headers:{origin:APP,'content-type':raw?body.type:'application/json'},body:raw?body:JSON.stringify(body)}),path.split('?')[0].split('/'),{identify:async()=>identity,defer:()=>{}});
  return {status:response.status,body:await response.json() as T};
}
before(async()=>{
  db=await startRehearsalDatabase([{email:ADMIN.email,role:'admin'},{email:EDITOR.email,role:'editor'}]);
  for(const person of [ADMIN,EDITOR])await owner('UPDATE core.users SET auth_subject=$2,email_verified=true WHERE email=$1',[person.email,person.subject]);
  [{id:adminId}]=await owner('SELECT id FROM core.users WHERE email=$1',[ADMIN.email]);
  await owner("INSERT INTO public.user_roles(user_id,role) VALUES($1,'platform_admin')",[adminId]);
  Object.assign(process.env,{REPORTER_DEPLOYMENT_MODE:'cloud',REPORTER_DATABASE_URL:db.runtime,REPORTER_WORKER_DATABASE_URL:db.worker,REPORTER_DEFAULT_PORTAL_ID:PILOT,
    REPORTER_WORKSPACES_MODE:'all',REPORTER_WORKER_PASSWORD:db.workerPassword,REPORTER_APP_ORIGINS:APP});
  storage=await startFakeS3({bucket:'reporter-source-media',corsOrigins:[APP]});
  Object.assign(process.env,{AWS_ENDPOINT_URL_S3:storage.endpoint,AWS_REGION:'us-east-1',AWS_ACCESS_KEY_ID:'synthetic',AWS_SECRET_ACCESS_KEY:'synthetic'});
  ({handleReporter:handle}=await import('../../src/server/http.ts'));
  const {createReporterWorker}=await import('../../functions/reporter-worker.ts');host=await startWorkerHost(createReporterWorker());process.env.REPORTER_WORKER_URL=host.url;
  const created=await api<{id:string}>('platform/workspaces',{name:'Other publication',slug:'other-publication'});assert.equal(created.status,201);second=created.body.id;
},{timeout:180000});
after(async()=>{
  await host?.stop();await storage?.stop();
  const pools=(globalThis as typeof globalThis&{reporterPools?:Partial<Record<string,Pool>>}).reporterPools??{};
  await Promise.all(Object.values(pools).map(pool=>pool?.end()));db?.stop();
});

test('new clients start empty; immutable branded packs preserve the adopted pilot catalog',async()=>{
  const pilot=await api<WorkspaceTemplateConfiguration>('w/reporter-ai/templates');assert.equal(pilot.status,200);assert.equal(pilot.body.pilot,true);
  const before=JSON.stringify(workspaceTemplateLibrary(pilot.body));
  const path=`platform/workspaces/${second}/templates`,empty=await api<WorkspaceTemplateConfiguration>(path);
  assert.equal(empty.status,200);assert.deepEqual(workspaceTemplateLibrary(empty.body).activeIds,[]);
  const config:WorkspaceTemplateInput={publication:'Other publication',presets:['editorial','photo','night','paper','minimal'],defaultPreset:'editorial',font:'Montserrat'};
  const saved=await api<WorkspaceTemplateConfiguration>(path,{revision:empty.body.revision,config});
  assert.equal(saved.status,200,JSON.stringify(saved.body));
  assert.equal(saved.body.active?.savedBy,adminId);assert.equal(workspaceTemplateLibrary(saved.body).activeIds.length,5);
  assert.equal((await api(path,{revision:empty.body.revision,config:{...config,publication:'Changed'}})).status,409);
  const changed=await api<WorkspaceTemplateConfiguration>(path,{revision:saved.body.revision,config:{...config,publication:'Changed'}});assert.equal(changed.status,200);
  const history=await api<WorkspaceTemplateConfiguration>(`w/other-publication/templates?hashes=${saved.body.active!.hash}`);
  assert.deepEqual(history.body.history,[saved.body.active]);
  const restored=await api<WorkspaceTemplateConfiguration>(path,{revision:changed.body.revision,config});assert.equal(restored.status,200);
  assert.deepEqual(restored.body.active,saved.body.active,'reactivation retains the original immutable revision');
  assert.equal((await owner('SELECT count(*)::int AS count FROM public.reporter_template_revisions WHERE portal_id=$1',[second]))[0].count,2);
  await assert.rejects(owner("UPDATE public.reporter_template_revisions SET doc=doc WHERE portal_id=$1",[second]),{code:'23514'});
  assert.equal(JSON.stringify(workspaceTemplateLibrary((await api<WorkspaceTemplateConfiguration>('w/reporter-ai/templates')).body)),before);
  assert.equal((await api('w/reporter-ai/templates',{revision:pilot.body.revision,config},EDITOR)).status,403);
  assert.equal((await owner('SELECT seq FROM public.reporter_ed_workspace WHERE portal_id=$1',[second]))[0].seq>0,true);
  assert.ok(!restored.body.readiness.missing.includes('templates'));
});

test('an empty client can configure its own rules but cannot enqueue generation prematurely',async()=>{
  const blank=await api<{value:{productionId:string}}>('w/other-publication/workspace',{method:'createBlank',args:[{title:'Incomplete setup',brief:{size:'standard',sections:3}}],requestId:randomUUID()});
  const snapshot=await api<import('../../src/ports/connected-workspace.ts').ConnectedWorkspace>('w/other-publication/workspace');
  assert.equal(snapshot.body.templateConfiguration?.workspaceId,second);
  assert.equal(snapshot.body.templateConfiguration?.active?.config.publication,'Other publication');
  const piece=snapshot.body.state.productions.find(entry=>entry.production.id===blank.body.value.productionId)!.pieces[0];
  const blocked=await api<{ok:boolean;refusal:{code:string;message:string}}>('w/other-publication/workspace',{method:'generation.start',args:['article.outline',{productionId:blank.body.value.productionId,pieceId:piece.id}],requestId:randomUUID()});
  assert.equal(blocked.body.ok,false);assert.equal(blocked.body.refusal.code,'workspace_not_ready');assert.match(blocked.body.refusal.message,/mapa editorial/);
  assert.equal((await owner('SELECT count(*)::int AS count FROM public.reporter_ed_runs WHERE portal_id=$1',[second]))[0].count,0);
});

test('private brands use the target client even when the real operator has no membership',async()=>{
  assert.equal((await owner('SELECT count(*)::int AS count FROM public.portal_members WHERE portal_id=$1 AND user_id=$2',[second,adminId]))[0].count,0);
  const bytes=await sharp({create:{width:1200,height:600,channels:4,background:{r:80,g:100,b:140,alpha:.4}}}).png().toBuffer();
  const uploaded=await api<WorkspaceBrandAsset>(`platform/workspaces/${second}/logo`,new Blob([new Uint8Array(bytes)],{type:'image/png'}));
  assert.equal(uploaded.status,201,JSON.stringify(uploaded.body));assert.equal(uploaded.body.workspaceId,second);assert.equal(uploaded.body.width,768);assert.equal(uploaded.body.height,384);
  const duplicate=await api<WorkspaceBrandAsset>(`platform/workspaces/${second}/logo`,new Blob([new Uint8Array(bytes)],{type:'image/png'}));assert.equal(duplicate.body.id,uploaded.body.id);
  const image=async(slug:string)=>{
    const path=['w',slug,'templates','logos',uploaded.body.id];return handle(new Request(`${APP}/api/reporter/${path.join('/')}`),path,{identify:async()=>ADMIN,defer:()=>{}});
  };
  assert.equal((await image('reporter-ai')).status,404);
  const actual=await image('other-publication');assert.equal(actual.status,200);
  const metadata=await sharp(Buffer.from(await actual.arrayBuffer())).metadata();assert.equal(metadata.hasAlpha,true);assert.equal(metadata.width,768);
  const pilot=await api<WorkspaceTemplateConfiguration>('w/reporter-ai/templates');
  const foreign=await api('w/reporter-ai/templates',{revision:pilot.body.revision,config:{publication:'Seafood',presets:['editorial'],defaultPreset:'editorial',font:'Inter',logoId:uploaded.body.id}});
  assert.equal(foreign.status,422);assert.equal(foreign.body.error,'TEMPLATE_UNKNOWN_LOGO');
  assert.equal((await api('w/reporter-ai/templates/logo',new Blob(['<svg/>'],{type:'image/svg+xml'}))).status,422);
  assert.equal((await api('w/reporter-ai/templates/logo',new Blob([new Uint8Array(bytes)],{type:'image/png'}),EDITOR)).status,403);
  assert.equal((await api(`platform/workspaces/${second}/logo`,new Blob([new Uint8Array(2*1024**2+1)],{type:'image/png'}))).status,413);
  const forbidden=new pg.Client({connectionString:db.worker});await forbidden.connect();
  try{await assert.rejects(forbidden.query('SELECT public.reporter_template_save($1,1,$2,$3)',[second,'0123456789abcdef','{}']),{code:'42501'});}
  finally{await forbidden.end();}
  assert.equal((await api(`w/other-publication/templates?hashes=${randomUUID()}`)).status,422);
});
