import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import pg,{type Pool} from 'pg';
import {startRehearsalDatabase} from '../support/rehearsal-db.ts';
import type {WorkspaceActivation} from '../../src/domain/workspace-management.ts';
const APP='http://127.0.0.1:3997';
const OP={subject:'activation-operator',email:'operator@activation.test',name:'Operator',image:undefined,emailVerified:true};
const MEMBER={...OP,subject:'activation-member',email:'member@activation.test',name:'Member'};
let db:Awaited<ReturnType<typeof startRehearsalDatabase>>,operator:string,pilotToken:string;
let handle:typeof import('../../src/server/http.ts').handleReporter;
async function owner(sql:string,values:unknown[]=[]){const client=new pg.Client({connectionString:db.owner});await client.connect();try{return(await client.query(sql,values)).rows;}finally{await client.end();}}
async function api<T=WorkspaceActivation&{error?:string}>(path:string,body?:unknown,identity=OP){
  const response=await handle(new Request(APP+'/api/reporter/'+path,{method:body===undefined?'GET':'POST',headers:{origin:APP,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),path.split('?')[0].split('/'),{identify:async()=>identity,defer:()=>{}});
  return{status:response.status,value:await response.json() as T};
}
before(async()=>{
  db=await startRehearsalDatabase([{email:OP.email,role:'admin'},{email:MEMBER.email,role:'admin'}],{activation:'admin'});
  for(const identity of [OP,MEMBER])await owner('UPDATE core.users SET auth_subject=$2,email_verified=true WHERE email=$1',[identity.email,identity.subject]);
  [{id:operator}]=await owner('SELECT id FROM core.users WHERE email=$1',[OP.email]);
  await owner("INSERT INTO public.user_roles(user_id,role) VALUES($1,'platform_admin')",[operator]);
  Object.assign(process.env,{REPORTER_DEPLOYMENT_MODE:'cloud',REPORTER_DATABASE_URL:db.runtime,REPORTER_WORKER_DATABASE_URL:db.worker,REPORTER_DEFAULT_PORTAL_ID:'10000000-0000-0000-0000-000000000101',REPORTER_APP_ORIGINS:APP});
  delete process.env.REPORTER_WORKSPACES_MODE;
  ({handleReporter:handle}=await import('../../src/server/http.ts'));
},{timeout:180000});
after(async()=>{await Promise.all(Object.values((globalThis as typeof globalThis&{reporterPools?:Partial<Record<string,Pool>>}).reporterPools??{}).map(pool=>pool?.end()));db?.stop();});

test('a new deployment starts with administrator-only availability and no client-specific environment setup',async()=>{
  const result=await api('platform/workspace-activation');assert.equal(result.status,200);assert.equal(result.value.mode,'admin');assert.equal(result.value.effective,'admin');assert.equal(result.value.revision,1);
  assert.equal((await api('platform/workspace-activation',undefined,MEMBER)).status,403);
  assert.equal((await api('w/reporter-ai/workspace',undefined,MEMBER)).status,403);
  const pilot=await api<{navigation:{enabled:boolean};syncToken:string}>('workspace',undefined,MEMBER);
  assert.equal(pilot.status,200);assert.equal(pilot.value.navigation.enabled,false);pilotToken=pilot.value.syncToken;
  const entry=await api<{enabled:boolean;items:unknown[];legacy:{href:string}}> ('workspaces',undefined,MEMBER);
  assert.equal(entry.status,200);assert.equal(entry.value.enabled,false);assert.deepEqual(entry.value.items,[]);assert.equal(entry.value.legacy.href,'/');
  const client=new pg.Client({connectionString:db.runtime});await client.connect();
  try{assert.equal((await client.query("SELECT public.reporter_workspace_activation()->>'mode' AS mode")).rows[0].mode,'admin');
    await assert.rejects(client.query("UPDATE public.reporter_workspace_activation SET mode='all'"),(error:unknown)=>(error as {code:string}).code==='42501');
  }finally{await client.end();}
});

test('only the real platform operator changes availability with a current revision and an audit trail',async()=>{
  assert.equal((await api('platform/workspace-activation',{mode:'all',revision:1},MEMBER)).status,403);
  const result=await api('platform/workspace-activation',{mode:'all',revision:1});assert.equal(result.status,200);assert.equal(result.value.mode,'all');assert.equal(result.value.effective,'all');assert.equal(result.value.revision,2);
  const enabled=await api<{navigation:{enabled:boolean};syncToken:string}>('workspace?since='+encodeURIComponent(pilotToken),undefined,MEMBER);
  assert.equal(enabled.status,200);assert.equal(enabled.value.navigation.enabled,true);assert.notEqual(enabled.value.syncToken,pilotToken);
  assert.equal((await api('w/reporter-ai/workspace',undefined,MEMBER)).status,200);
  const stale=await api('platform/workspace-activation',{mode:'off',revision:1});assert.equal(stale.status,409);assert.equal(stale.value.error,'conflict');
  const [audit]=await owner("SELECT user_id,before_data,after_data,correlation_id FROM public.audit_log WHERE action='platform.navigation.changed'");
  assert.equal(audit.user_id,operator);assert.equal(audit.before_data.mode,'admin');assert.equal(audit.after_data.mode,'all');assert.ok(audit.correlation_id);
  assert.equal((await api('platform/workspace-activation',{mode:'all',revision:2})).value.revision,2,'a no-op does not duplicate the activation');
  assert.equal((await owner("SELECT count(*)::int AS n FROM public.audit_log WHERE action='platform.navigation.changed'"))[0].n,1);
});

test('an environment ceiling cannot be raised by the policy or by posted effective-mode input',async()=>{
  process.env.REPORTER_WORKSPACES_MODE='admin';
  const limited=await api('platform/workspace-activation');assert.equal(limited.value.mode,'all');assert.equal(limited.value.effective,'admin');
  assert.equal((await api('platform/workspace-activation',{mode:'all',revision:2,effective:'all'})).status,409);
  process.env.REPORTER_WORKSPACES_MODE='off';assert.equal((await api('platform/workspace-activation')).value.effective,'off');
  delete process.env.REPORTER_WORKSPACES_MODE;
});


test('pausing navigation removes addressed access while retaining the original pilot and surviving migration replay',async()=>{
  const admin=await api('platform/workspace-activation',{mode:'admin',revision:2});assert.equal(admin.value.revision,3);
  assert.equal((await api('w/reporter-ai/workspace',undefined,MEMBER)).status,403);
  assert.equal((await api('w/reporter-ai/workspace')).status,200);
  assert.equal((await api('workspace',undefined,MEMBER)).status,200);
  const paused=await api('platform/workspace-activation',{mode:'off',revision:3});assert.equal(paused.value.effective,'off');
  assert.equal((await api('w/reporter-ai/workspace')).status,403);assert.equal((await api('workspace',undefined,MEMBER)).status,200);
  const entry=await api<{enabled:boolean;legacy:{href:string}}>('workspaces',undefined,MEMBER);
  assert.equal(entry.value.enabled,false);assert.equal(entry.value.legacy.href,'/');
  const resumed=await api('platform/workspace-activation',{mode:'all',revision:4});assert.equal(resumed.value.effective,'all');
  db.migrate();
  assert.deepEqual((await api('platform/workspace-activation')).value,resumed.value,'migration replay retains the chosen mode, revision and activation time');
});
