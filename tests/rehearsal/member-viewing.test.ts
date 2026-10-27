import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import pg,{type Pool} from 'pg';
import {startRehearsalDatabase} from '../support/rehearsal-db.ts';
import type {MemberView} from '../../src/domain/member-view.ts';
import type {ReporterRequestContext} from '../../src/server/request-context.ts';

const PILOT='10000000-0000-0000-0000-000000000101';
const OPERATOR={email:'support-operator@rehearsal.test',subject:'support-operator'};
const READER={email:'support-reader@rehearsal.test',subject:'support-reader'};
const OTHER={email:'support-other@rehearsal.test',subject:'support-other'};
let db:Awaited<ReturnType<typeof startRehearsalDatabase>>,operator:string,reader:string,other:string;
let transaction:typeof import('../../src/server/database.ts').transaction;
let runWithReporterContext:typeof import('../../src/server/request-context.ts').runWithReporterContext;
async function owner(sql:string,values:unknown[]=[]){
  const client=new pg.Client({connectionString:db.owner});await client.connect();
  try{return(await client.query(sql,values)).rows;}finally{await client.end();}
}
async function runtime<T>(actor:string,operation:(client:pg.Client)=>Promise<T>){
  const client=new pg.Client({connectionString:db.runtime});await client.connect();
  try{
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.access_mode','platform',true),set_config('app.user_id',$1,true),set_config('app.request_id',$2,true),set_config('app.correlation_id',$2,true)",[actor,randomUUID()]);
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
  db=await startRehearsalDatabase([{email:OPERATOR.email,role:'admin'},{email:READER.email,role:'editor'},{email:OTHER.email,role:'approver'}]);
  for(const identity of [OPERATOR,READER,OTHER])await owner('UPDATE core.users SET auth_subject=$2,email_verified=true WHERE email=$1',[identity.email,identity.subject]);
  [{id:operator}]=await owner('SELECT id FROM core.users WHERE email=$1',[OPERATOR.email]);
  [{id:reader}]=await owner('SELECT id FROM core.users WHERE email=$1',[READER.email]);
  [{id:other}]=await owner('SELECT id FROM core.users WHERE email=$1',[OTHER.email]);
  await owner("INSERT INTO public.user_roles(user_id,role) VALUES($1,'platform_admin'),($2,'platform_admin')",[operator,reader]);
  Object.assign(process.env,{REPORTER_DEPLOYMENT_MODE:'cloud',REPORTER_DATABASE_URL:db.runtime,REPORTER_WORKER_DATABASE_URL:db.worker,REPORTER_DEFAULT_PORTAL_ID:PILOT});
  ({transaction}=await import('../../src/server/database.ts'));
  ({runWithReporterContext}=await import('../../src/server/request-context.ts'));
},{timeout:180000});
after(async()=>{
  const pools=(globalThis as typeof globalThis&{reporterPools?:Partial<Record<string,Pool>>}).reporterPools??{};
  await Promise.all(Object.values(pools).map(pool=>pool?.end()));db?.stop();
});

test('an audited support view retains its actual operator and only the selected membership roles',async()=>{
  const view=await start(),resolved=await resolve(view.id);
  assert.equal(view.operator.id,operator);assert.equal(view.person.id,reader);assert.deepEqual(view.person.roles,['editor']);
  assert.equal(view.readOnly,true);assert.ok(view.remainingMs>0&&view.remainingMs<=300000);
  assert.equal(resolved.context.actor,reader);assert.equal(resolved.context.administrative,false);
  assert.deepEqual(resolved.context.roles,['editor'],'the viewed member also has a global platform role, which must not be combined');
  const [audit]=await owner("SELECT user_id,after_data FROM public.audit_log WHERE entity_id=$1 AND action='platform.member_view.started'",[view.id]);
  assert.equal(audit.user_id,operator);assert.equal(audit.after_data.personId,reader);
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
