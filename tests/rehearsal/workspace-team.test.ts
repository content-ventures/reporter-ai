import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import pg,{type Pool} from 'pg';
import type {PlatformPerson,IssuedInvite} from '../../src/domain/platform.ts';
import type {WorkspaceMembership} from '../../src/domain/workspace-management.ts';
import {startRehearsalDatabase} from '../support/rehearsal-db.ts';

const APP='http://127.0.0.1:3994';
const OP={subject:'team-operator',email:'operator@team.test',name:'Operator',image:undefined,emailVerified:true};
const ADMIN={subject:'team-admin',email:'admin@team.test',name:'Administrator',image:undefined,emailVerified:true};
const EDITOR={subject:'team-editor',email:'editor@team.test',name:'Editor',image:undefined,emailVerified:true};
let db:Awaited<ReturnType<typeof startRehearsalDatabase>>,handle:typeof import('../../src/server/http.ts').handleReporter;
let second:string,operatorId:string,editorId:string;
async function owner(sql:string,values:unknown[]=[]){
  const client=new pg.Client({connectionString:db.owner});await client.connect();
  try{return(await client.query(sql,values)).rows;}finally{await client.end();}
}
async function api<T=Record<string,unknown>>(path:string,body?:unknown,identity=OP,account?:string){
  const response=await handle(new Request(`${APP}/api/reporter/${path}`,{method:body===undefined?'GET':'POST',
    headers:{origin:APP,'content-type':'application/json',...(account?{'x-reporter-account':account}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),
    path.split('?')[0].split('/'),{identify:async()=>identity,defer:()=>{}});
  return{status:response.status,body:await response.json() as T};
}
before(async()=>{
  db=await startRehearsalDatabase([{email:OP.email,role:'admin'},{email:ADMIN.email,role:'admin'},{email:EDITOR.email,role:'editor'}]);
  for(const person of [OP,ADMIN,EDITOR])await owner('UPDATE core.users SET auth_subject=$2,email_verified=true WHERE email=$1',[person.email,person.subject]);
  [{id:operatorId}]=await owner('SELECT id FROM core.users WHERE email=$1',[OP.email]);
  [{id:editorId}]=await owner('SELECT id FROM core.users WHERE email=$1',[EDITOR.email]);
  await owner("INSERT INTO public.user_roles(user_id,role) VALUES($1,'platform_admin')",[operatorId]);
  Object.assign(process.env,{REPORTER_DEPLOYMENT_MODE:'cloud',REPORTER_DATABASE_URL:db.runtime,REPORTER_WORKER_DATABASE_URL:db.worker,
    REPORTER_DEFAULT_PORTAL_ID:'10000000-0000-0000-0000-000000000101',REPORTER_WORKSPACES_MODE:'all',REPORTER_APP_ORIGINS:APP});
  ({handleReporter:handle}=await import('../../src/server/http.ts'));
  const created=await api<{id:string}>('platform/workspaces',{name:'Private second client',slug:'private-second'});assert.equal(created.status,201);second=created.body.id;
},{timeout:180000});
after(async()=>{
  const pools=(globalThis as typeof globalThis&{reporterPools?:Partial<Record<string,Pool>>}).reporterPools??{};
  await Promise.all(Object.values(pools).map(pool=>pool?.end()));db?.stop();
});

test('a workspace administrator sees only the managed membership when linking an existing account',async()=>{
  const issued=await api<IssuedInvite>('w/reporter-ai/team/invites',{name:EDITOR.name,email:EDITOR.email,role:'approver',workspaceId:second},ADMIN);
  assert.equal(issued.status,409,'posted destination is rejected rather than overriding the addressed client');
  const global=await api<IssuedInvite>('platform/invites',{name:EDITOR.name,email:EDITOR.email,role:'approver',workspaceId:second});
  assert.equal(global.status,200);assert.equal(global.body.person.memberships?.length,2);
  const [{token_hash:hash}]=await owner('SELECT token_hash FROM core.access_invites WHERE portal_id=$1',[second]);
  await owner('SELECT public.reporter_invite_accept($1,$2)',[hash,EDITOR.subject]);
  const client=await api<IssuedInvite>('w/reporter-ai/team/invites',{name:'New member',email:'new@team.test',role:'editor'},ADMIN);
  assert.equal(client.status,201,JSON.stringify(client.body));assert.equal(client.body.person.memberships?.length,1);
  assert.equal(client.body.person.workspace?.slug,'reporter-ai');assert.ok(!JSON.stringify(client.body).includes(second));
  const page=await api<{items:(WorkspaceMembership&{name:string})[];total:number}>('w/reporter-ai/team?limit=1&offset=0',undefined,ADMIN);
  assert.equal(page.status,200);assert.equal(page.body.items.length,1);assert.ok(page.body.total>=4);
  assert.ok(page.body.items[0].name);assert.ok(!JSON.stringify(page.body).includes(second));
  const link=client.body.person.memberships![0];
  const renewed=await api<IssuedInvite>(`w/reporter-ai/team/${link.personId}/renew-invite`,{revision:link.revision},ADMIN);
  assert.equal(renewed.status,200);assert.equal(renewed.body.person.memberships?.length,1);
  assert.equal((await api(`w/reporter-ai/team/${link.personId}/renew-invite`,{revision:link.revision},ADMIN)).status,409);
  assert.equal((await api('w/reporter-ai/team',undefined,EDITOR)).status,403);
  assert.equal((await api('w/private-second/team',undefined,ADMIN)).status,404);
});

test('global operators manage an addressed client as themselves, without gaining a membership',async()=>{
  const page=await api<{items:WorkspaceMembership[]}>('w/private-second/team');assert.equal(page.status,200,JSON.stringify(page.body));
  const member=page.body.items.find(item=>item.personId===editorId)!;
  const changed=await api<WorkspaceMembership>(`w/private-second/team/${editorId}`,{revision:member.revision,roles:['editor']});assert.equal(changed.status,200);
  assert.deepEqual(changed.body.roles,['editor']);
  assert.equal((await api(`w/private-second/team/${editorId}`,{revision:member.revision,status:'suspended'})).status,409);
  const own=await owner('SELECT count(*)::int AS n FROM public.portal_members WHERE portal_id=$1 AND user_id=$2',[second,operatorId]);assert.equal(own[0].n,0);
  const audit=await owner("SELECT user_id FROM public.audit_log WHERE portal_id=$1 AND action='platform.membership.roles' ORDER BY created_at DESC LIMIT 1",[second]);
  assert.equal(audit[0].user_id,operatorId);
  assert.equal((await api(`platform/workspaces/${second}`,undefined,OP,editorId)).status,409,'queued global commands cannot acquire another account');
});

test('workspace suspension leaves the other membership usable and exposes global suspension separately',async()=>{
  const page=await api<{items:(WorkspaceMembership&{accountSuspended:boolean})[]}>(`platform/workspaces/${second}/team`);
  const member=page.body.items.find(item=>item.personId===editorId)!;
  assert.equal((await api(`w/private-second/team/${editorId}`,{revision:member.revision,status:'suspended'})).status,200);
  assert.equal((await api('w/reporter-ai/workspace',undefined,EDITOR)).status,200);
  assert.equal((await api('w/private-second/workspace',undefined,EDITOR)).status,404);
  assert.equal((await api(`platform/people/${editorId}/account-status`,{suspended:true},ADMIN)).status,403);
  assert.equal((await api<PlatformPerson>(`platform/people/${editorId}/account-status`,{suspended:true})).status,200);
  const suspended=await api<{items:(WorkspaceMembership&{accountSuspended:boolean})[]}>('w/reporter-ai/team',undefined,ADMIN);
  const target=suspended.body.items.find(item=>item.personId===editorId)!;assert.equal(target.status,'active');assert.equal(target.accountSuspended,true);
});
