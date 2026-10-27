import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import pg,{type Pool} from 'pg';
import sharp from 'sharp';
import {startRehearsalDatabase} from '../support/rehearsal-db.ts';
import {startFakeS3} from '../support/fake-s3.ts';
import type {MemberView} from '../../src/domain/member-view.ts';
import type {ReporterRequestContext} from '../../src/server/request-context.ts';

const PILOT='10000000-0000-0000-0000-000000000101';
const OPERATOR={email:'support-operator@rehearsal.test',subject:'support-operator'};
const READER={email:'support-reader@rehearsal.test',subject:'support-reader'};
const OTHER={email:'support-other@rehearsal.test',subject:'support-other'};
const OUTSIDER={email:'support-outsider@rehearsal.test',subject:'support-outsider'};
const SESSION_HASH=createHash('sha256').update(`login:${OPERATOR.subject}`).digest('hex');
let db:Awaited<ReturnType<typeof startRehearsalDatabase>>,operator:string,reader:string,other:string;
let storage:Awaited<ReturnType<typeof startFakeS3>>,outsider:string;
let transaction:typeof import('../../src/server/database.ts').transaction;
let runWithReporterContext:typeof import('../../src/server/request-context.ts').runWithReporterContext;
let handle:typeof import('../../src/server/http.ts').handleReporter;
const APP='http://127.0.0.1:3996';
async function api(path:string,options:{body?:unknown;view?:string;account?:string;identity?:typeof OPERATOR;session?:string}={}){
  const identity=options.identity??OPERATOR,headers=new Headers();
  if(options.view)headers.set('x-reporter-view',options.view);
  if(options.account)headers.set('x-reporter-account',options.account);
  if(options.body!==undefined){headers.set('origin',APP);headers.set('content-type','application/json');}
  const response=await handle(new Request(APP+'/api/reporter/'+path,{headers,...(options.body===undefined?{}:{method:'POST',body:JSON.stringify(options.body)})}),path.split('?')[0].split('/'),
    {identify:async()=>({...identity,name:identity.email,image:undefined,emailVerified:true,sessionId:options.session??`login:${identity.subject}`}),defer:()=>{throw new Error('Support viewing must not schedule processing');}});
  return{status:response.status,headers:response.headers,value:await response.json()};
}
async function owner(sql:string,values:unknown[]=[]){
  const client=new pg.Client({connectionString:db.owner});await client.connect();
  try{return(await client.query(sql,values)).rows;}finally{await client.end();}
}
async function runtime<T>(actor:string,operation:(client:pg.Client)=>Promise<T>){
  const client=new pg.Client({connectionString:db.runtime});await client.connect();
  try{
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.access_mode','platform',true),set_config('app.user_id',$1,true),set_config('app.request_id',$2,true),set_config('app.correlation_id',$2,true)",[actor,randomUUID()]);
    await client.query("SELECT set_config('app.auth_session',$1,true)",[SESSION_HASH]);
    const answer=await operation(client);await client.query('COMMIT');return answer;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{await client.end();}
}
async function start():Promise<MemberView>{
  return runtime(operator,async client=>(await client.query('SELECT public.reporter_member_view_start($1,$2) AS value',[PILOT,reader])).rows[0].value);
}
type Resolved={context:ReporterRequestContext;view:MemberView;error?:string};
async function resolve(id:string,identity=OPERATOR,slug:string|null='reporter-ai'):Promise<Resolved>{
  return runtime(operator,async client=>(await client.query('SELECT public.reporter_member_view_context($1,$2,true,$3,$4) AS value',
    [identity.subject,identity.email,id,slug])).rows[0].value);
}
async function end(id:string,identity=OPERATOR){
  return runtime(operator,async client=>(await client.query("SELECT public.reporter_member_view_end($1,$2,true,$3,'exit') AS value",
    [identity.subject,identity.email,id])).rows[0].value as boolean);
}
before(async()=>{
  db=await startRehearsalDatabase([{email:OPERATOR.email,role:'admin'},{email:READER.email,role:'editor'},{email:OTHER.email,role:'approver'},{email:OUTSIDER.email,role:'editor'}]);
  for(const identity of [OPERATOR,READER,OTHER,OUTSIDER])await owner('UPDATE core.users SET auth_subject=$2,email_verified=true WHERE email=$1',[identity.email,identity.subject]);
  [{id:operator}]=await owner('SELECT id FROM core.users WHERE email=$1',[OPERATOR.email]);
  [{id:reader}]=await owner('SELECT id FROM core.users WHERE email=$1',[READER.email]);
  [{id:other}]=await owner('SELECT id FROM core.users WHERE email=$1',[OTHER.email]);
  [{id:outsider}]=await owner('SELECT id FROM core.users WHERE email=$1',[OUTSIDER.email]);
  await owner("UPDATE public.portal_members SET status='disabled' WHERE portal_id=$1 AND user_id=$2",[PILOT,outsider]);
  await owner("INSERT INTO public.user_roles(user_id,role) VALUES($1,'platform_admin'),($2,'platform_admin')",[operator,reader]);
  Object.assign(process.env,{REPORTER_DEPLOYMENT_MODE:'cloud',REPORTER_DATABASE_URL:db.runtime,REPORTER_WORKER_DATABASE_URL:db.worker,REPORTER_DEFAULT_PORTAL_ID:PILOT,REPORTER_WORKSPACES_MODE:'all'});
  storage=await startFakeS3({bucket:'reporter-source-media',corsOrigins:[APP]});
  Object.assign(process.env,{AWS_ENDPOINT_URL_S3:storage.endpoint,AWS_REGION:'us-east-1',AWS_ACCESS_KEY_ID:'synthetic-access-key',AWS_SECRET_ACCESS_KEY:'synthetic-secret-key'});
  ({transaction}=await import('../../src/server/database.ts'));
  ({runWithReporterContext}=await import('../../src/server/request-context.ts'));
  ({handleReporter:handle}=await import('../../src/server/http.ts'));
},{timeout:180000});
after(async()=>{
  const pools=(globalThis as typeof globalThis&{reporterPools?:Partial<Record<string,Pool>>}).reporterPools??{};
  await Promise.all(Object.values(pools).map(pool=>pool?.end()));db?.stop();
  await storage?.stop();
});

test('an audited support view retains its actual operator and only the selected membership roles',async()=>{
  const view=await start(),resolved=await resolve(view.id);
  assert.equal(view.operator.id,operator);assert.equal(view.person.id,reader);assert.deepEqual(view.person.roles,['editor']);
  assert.equal(view.readOnly,true);assert.ok(view.remainingMs>0&&view.remainingMs<=300000);
  assert.equal(resolved.context.actor,reader);assert.equal(resolved.context.administrative,false);
  assert.deepEqual(resolved.context.roles,['editor'],'the viewed member also has a global platform role, which must not be combined');
  const [audit]=await owner("SELECT user_id,after_data FROM public.audit_log WHERE entity_id=$1 AND action='platform.member_view.started'",[view.id]);
  assert.equal(audit.user_id,operator);assert.equal(audit.after_data.personId,reader);
  const ledger=await api(`platform/log?workspaceId=${PILOT}&personId=${reader}`);
  assert.equal(ledger.status,200);
  const record=ledger.value.items.find((entry:{id:string})=>entry.id===audit.id)||ledger.value.items.find((entry:{action:string})=>entry.action==='member_view.started');
  assert.equal(record.actor.id,operator);assert.equal(record.target.id,reader);assert.equal(record.workspace.id,PILOT);
});

test('another account and another client cannot reuse the view, and a wrong address does not revoke its real tab',async()=>{
  const view=await start();
  assert.equal((await resolve(view.id,OTHER)).error,'MEMBER_VIEW_UNAVAILABLE');
  assert.equal((await resolve(view.id,OPERATOR,'another-client')).error,'MEMBER_VIEW_UNAVAILABLE');
  assert.equal(await end(view.id,OTHER),false);
  assert.equal((await resolve(view.id)).context.actor,reader);assert.notEqual(other,operator);
});

test('views are independent contexts, and an ordinary member cannot establish one',async()=>{
  const a=await start(),b=await start();assert.notEqual(a.id,b.id);
  assert.equal(await end(a.id),true);assert.equal((await resolve(b.id)).context.actor,reader);
  await assert.rejects(runtime(other,client=>client.query('SELECT public.reporter_member_view_start($1,$2)',[PILOT,reader])),
    (error:unknown)=>(error as {code?:string}).code==='42501');
});

test('the database independently permits snapshot reads and refuses every write in the view transaction',async()=>{
  const view=await start(),resolved=await resolve(view.id),context={...resolved.context,view:resolved.view};
  await runWithReporterContext(context,()=>transaction('runtime',async client=>{
    assert.equal((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only,'on');
    const snapshot=(await client.query("SELECT public.reporter_ed_load('{\"write\":false}') AS value")).rows[0].value;
    assert.ok(snapshot);
  }));
  await assert.rejects(runWithReporterContext(context,()=>transaction('runtime',client=>client.query("SELECT public.reporter_ed_load('{\"write\":true}')"))),
    (error:unknown)=>(error as {code?:string}).code==='42501');
  await assert.rejects(runWithReporterContext(context,()=>transaction('runtime',client=>client.query("SELECT public.reporter_update_profile('{\"name\":\"Forbidden change\"}')"))),
    (error:unknown)=>(error as {code?:string}).code==='25006');
  assert.notEqual((await owner('SELECT name FROM core.users WHERE id=$1',[reader]))[0].name,'Forbidden change');
});

test('membership changes refuse an already resolved transaction and close the view with actual-operator attribution',async()=>{
  const view=await start(),resolved=await resolve(view.id);
  await owner('UPDATE public.portal_members SET revision=revision+1 WHERE portal_id=$1 AND user_id=$2',[PILOT,reader]);
  await assert.rejects(runWithReporterContext({...resolved.context,view:resolved.view},()=>transaction('runtime',client=>client.query('SELECT 1'))),
    (error:unknown)=>(error as {code?:string}).code==='MEMBER_VIEW_ENDED');
  assert.equal((await resolve(view.id)).error,'MEMBER_VIEW_ENDED');
  const [audit]=await owner("SELECT user_id,after_data FROM public.audit_log WHERE entity_id=$1 AND action='platform.member_view.ended'",[view.id]);
  assert.equal(audit.user_id,operator);assert.equal(audit.after_data.reason,'membership_changed');
});

test('expiry commits one end audit and never revives the view on repeated access or exit',async()=>{
  const view=await start();
  await owner("UPDATE core.reporter_member_views SET created_at=clock_timestamp()-interval '10 minutes',expires_at=clock_timestamp()-interval '5 minutes' WHERE id=$1",[view.id]);
  assert.equal((await resolve(view.id)).error,'MEMBER_VIEW_ENDED');assert.equal((await resolve(view.id)).error,'MEMBER_VIEW_ENDED');
  assert.equal(await end(view.id),true);
  const rows=await owner("SELECT user_id,after_data FROM public.audit_log WHERE entity_id=$1 AND action='platform.member_view.ended'",[view.id]);
  assert.equal(rows.length,1);assert.equal(rows[0].user_id,operator);assert.equal(rows[0].after_data.reason,'expired');
});

test('the real account can end its own context after losing platform administration',async()=>{
  const view=await start();await owner("DELETE FROM public.user_roles WHERE user_id=$1 AND role='platform_admin'",[operator]);
  try{
    assert.equal(await end(view.id),true);
    const [row]=await owner('SELECT ended_at,end_reason FROM core.reporter_member_views WHERE id=$1',[view.id]);
    assert.ok(row.ended_at);assert.equal(row.end_reason,'operator_revoked');
    assert.equal((await resolve(view.id)).error,'MEMBER_VIEW_ENDED');
  }finally{await owner("INSERT INTO public.user_roles(user_id,role) VALUES($1,'platform_admin')",[operator]);}
});

test('workspace archival ends the view, and restoring the workspace does not restore that viewing context',async()=>{
  const view=await start();
  await owner("UPDATE public.reporter_workspaces SET lifecycle='archived' WHERE portal_id=$1",[PILOT]);
  try{assert.equal((await resolve(view.id)).error,'MEMBER_VIEW_ENDED');}
  finally{await owner("UPDATE public.reporter_workspaces SET lifecycle='active' WHERE portal_id=$1",[PILOT]);}
  assert.equal((await resolve(view.id)).error,'MEMBER_VIEW_ENDED');
});

test('the HTTP read projection retains the real account and marks its effective member view as uncached',async()=>{
  const created=await api('platform/member-views',{body:{workspaceId:PILOT,personId:reader}});assert.equal(created.status,201);
  const view=created.value as MemberView;
  const snapshot=await api('w/reporter-ai/workspace',{view:view.id,account:operator});assert.equal(snapshot.status,200);
  assert.equal(snapshot.value.state.sessionPersonId,reader);
  assert.equal(snapshot.value.navigation.accountId,operator);assert.equal(snapshot.value.navigation.view.id,view.id);
  assert.equal(snapshot.value.navigation.view.operator.id,operator);assert.equal(snapshot.value.navigation.view.readOnly,true);
  assert.equal(snapshot.value.state.members.find((member:{personId:string})=>member.personId===reader).readOnly,true);
  assert.equal(JSON.stringify(snapshot.value).includes(SESSION_HASH),false,'the login digest is server-only');
  assert.match(snapshot.headers.get('cache-control')??'',/no-store/);
  const idle=await api(`w/reporter-ai/workspace?since=${encodeURIComponent(snapshot.value.syncToken)}`,{view:view.id,account:operator});
  assert.equal(idle.status,200);assert.equal(idle.value.unchanged,true);assert.ok(JSON.stringify(idle.value).length<1000);
  assert.equal((await api('w/reporter-ai/pipeline',{view:view.id,account:reader})).status,409);
  assert.equal((await api('w/reporter-ai/pipeline',{view:'invalid-view',account:operator})).status,403);
});

test('disabled workspace navigation cannot establish a support view',async()=>{
  const [before]=await owner('SELECT count(*)::integer AS total FROM core.reporter_member_views');
  process.env.REPORTER_WORKSPACES_MODE='off';
  try{assert.equal((await api('platform/member-views',{body:{workspaceId:PILOT,personId:reader}})).status,403);}
  finally{process.env.REPORTER_WORKSPACES_MODE='all';}
  assert.equal((await owner('SELECT count(*)::integer AS total FROM core.reporter_member_views'))[0].total,before.total);
});

test('a new login cannot resume a previous viewing context even when the actual account is unchanged',async()=>{
  const view=await start();
  const changed=await api('w/reporter-ai/workspace',{view:view.id,account:operator,session:'new-login-for-the-same-account'});
  assert.equal(changed.status,410);assert.equal(changed.value.error,'MEMBER_VIEW_ENDED');
  assert.equal((await resolve(view.id)).error,'MEMBER_VIEW_ENDED');
  const [row]=await owner('SELECT end_reason FROM core.reporter_member_views WHERE id=$1',[view.id]);
  assert.equal(row.end_reason,'account_changed');
});

test('all preview mutations and global or legacy escapes fail before validation, uploads or provider scheduling',async()=>{
  const view=await start();
  for(const path of ['workspace','profile','uploads','templates/logo','team/invites','news/search','citations/example/fact-check','visuals/generate']){
    const answer=await api('w/reporter-ai/'+path,{view:view.id,account:operator,body:{}});
    assert.equal(answer.status,403,path);assert.equal(answer.value.error,'MEMBER_VIEW_READ_ONLY',path);
  }
  for(const path of ['platform/workspaces','invites/invalid','workspace']){
    const answer=await api(path,{view:view.id,account:operator,body:{}});assert.equal(answer.status,403,path);
    assert.equal(answer.value.error,'MEMBER_VIEW_UNAVAILABLE',path);
  }
  assert.equal((await api(`workspace?_view=${view.id}`,{account:operator})).status,403);
  assert.equal((await api('w/another-client/pipeline',{view:view.id,account:operator})).status,410);
});

test('the HTTP exit is owned, idempotent and remains available after platform-role revocation',async()=>{
  const view=await start();
  assert.equal((await api(`member-views/${view.id}/end`,{identity:OTHER,account:other,body:{reason:'exit'}})).status,403);
  await owner("DELETE FROM public.user_roles WHERE user_id=$1 AND role='platform_admin'",[operator]);
  try{
    assert.equal((await api(`member-views/${view.id}/end`,{account:operator,body:{reason:'exit'}})).status,200);
    assert.equal((await api(`member-views/${view.id}/end`,{account:operator,body:{reason:'exit'}})).status,200);
    const rows=await owner("SELECT user_id,after_data,correlation_id FROM public.audit_log WHERE entity_id=$1 AND action='platform.member_view.ended'",[view.id]);
    assert.equal(rows.length,1);assert.equal(rows[0].user_id,operator);assert.ok(rows[0].correlation_id);
    assert.equal(rows[0].after_data.reason,'operator_revoked');
  }finally{await owner("INSERT INTO public.user_roles(user_id,role) VALUES($1,'platform_admin')",[operator]);}
});

test('private avatar bytes are checked as the member, bypass no warm administrator cache, and stop after expiry',async()=>{
  const stored:string[]=[];
  for(const [person,color]of [[reader,'#204060'],[outsider,'#804020']]as const){
    const bytes=await sharp({create:{width:16,height:16,channels:3,background:color}}).webp().toBuffer();
    const file=createHash('sha256').update(bytes).digest('hex')+'.image',path=`/api/reporter/avatars/${person}/${PILOT}/${file}`;
    storage.objects.set(`reporter-source-media/images/${PILOT}/${file}`,{body:bytes,contentType:'image/webp',etag:'"synthetic"'});
    await owner('UPDATE core.users SET image=$2,profile_updated_at=clock_timestamp() WHERE id=$1',[person,path]);stored.push(path);
  }
  const previous=process.env.REPORTER_FUNCTION_RUNTIME;process.env.REPORTER_FUNCTION_RUNTIME='true';
  const image=(path:string)=>handle(new Request(APP+path),new URL(APP+path).pathname.slice('/api/reporter/'.length).split('/'),
    {identify:async()=>({...OPERATOR,name:'Operator',emailVerified:true,sessionId:`login:${OPERATOR.subject}`}),defer:()=>{}});
  try{
    const warm=await image(stored[1]);assert.equal(warm.status,200);const foreignBytes=Buffer.from(await warm.arrayBuffer());assert.ok(foreignBytes.length);
    const view=await start(),before=storage.requests.length;
    assert.equal((await image(stored[1]+`?_view=${view.id}`)).status,404);
    assert.equal(storage.requests.length,before,'a refused member read never reaches storage');
    const own=await image(stored[0]+`?_view=${view.id}`);assert.equal(own.status,200);assert.match(own.headers.get('cache-control')??'',/no-store/);
    assert.notDeepEqual(Buffer.from(await own.arrayBuffer()),foreignBytes);
    const snapshot=await api('w/reporter-ai/workspace',{view:view.id,account:operator});assert.equal(snapshot.status,200);
    assert.equal(snapshot.value.state.people.find((person:{id:string})=>person.id===reader).avatarUrl,stored[0]+`?_view=${view.id}`);
    await owner("UPDATE core.reporter_member_views SET created_at=clock_timestamp()-interval '10 minutes',expires_at=clock_timestamp()-interval '5 minutes' WHERE id=$1",[view.id]);
    const requests=storage.requests.length;assert.equal((await image(stored[0]+`?_view=${view.id}`)).status,410);assert.equal(storage.requests.length,requests);
  }finally{if(previous===undefined)delete process.env.REPORTER_FUNCTION_RUNTIME;else process.env.REPORTER_FUNCTION_RUNTIME=previous;}
});


test('a viewed workspace administrator can inspect client setup and team without management locks or write authority',async()=>{
  const page=await api('platform/directory?personId='+other),member=page.value.people[0].memberships.find((entry:{workspace:{id:string}})=>entry.workspace.id===PILOT);
  const changed=await api(`platform/workspaces/${PILOT}/members/${other}`,{body:{revision:member.revision,roles:['admin']}});
  assert.equal(changed.status,200);
  const created=await api('platform/member-views',{body:{workspaceId:PILOT,personId:other}});assert.equal(created.status,201);
  const options={view:created.value.id,account:operator};
  assert.equal((await api('w/reporter-ai/team/workspace',options)).status,200);
  assert.equal((await api('w/reporter-ai/team',options)).status,200);
  assert.equal((await api('w/reporter-ai/templates',options)).status,200);
  assert.equal((await api('w/reporter-ai/team/invites',{...options,body:{name:'Denied',email:'denied@example.test',role:'editor'}})).status,403);
  await api(`member-views/${created.value.id}/end`,{body:{reason:'exit'}});
});
