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
  await owner('UPDATE core.users SET image=$2 WHERE id=$1',[editorId,`/api/reporter/profile/avatar/${'a'.repeat(64)}.image`]);
  const page=await api<{items:WorkspaceMembership[]}>('w/private-second/team');assert.equal(page.status,200,JSON.stringify(page.body));
  const avatar=await api<{items:(WorkspaceMembership&{avatarUrl?:string})[]}>('w/private-second/team');
  assert.ok(avatar.body.items.find(item=>item.personId===editorId)?.avatarUrl?.includes(`/avatars/${editorId}/`),'team photos use the account ID rather than the membership ID');
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

test('directory paging and operational filters keep exact totals beyond the first page',async()=>{
  await owner(`WITH added AS (INSERT INTO core.users(name,email,auth_subject,email_verified)
    SELECT 'Paged member '||n,'page-'||n||'@team.test','paged-subject-'||n,true FROM generate_series(1,125) n RETURNING id),
    tenant AS (INSERT INTO core.tenant_members(tenant_id,user_id,role,status)
      SELECT p.tenant_id,a.id,'member','active' FROM added a CROSS JOIN public.portals p WHERE p.id=$1 RETURNING user_id)
    INSERT INTO public.portal_members(tenant_id,portal_id,user_id,status)
      SELECT p.tenant_id,p.id,t.user_id,'active' FROM tenant t CROSS JOIN public.portals p WHERE p.id=$1`,[second]);
  type Page={people:PlatformPerson[];total:number;counts:{all:number};offset:number};
  const first=await api<Page>(`platform/directory?workspaceId=${second}&search=Paged&limit=20`);
  const next=await api<Page>(`platform/directory?workspaceId=${second}&search=Paged&limit=20&offset=20`);
  assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.total,125);assert.equal(first.body.counts.all,125);
  assert.equal(first.body.people.length,20);assert.equal(next.body.people.length,20);assert.equal(next.body.offset,20);
  assert.equal(new Set([...first.body.people,...next.body.people].map(person=>person.id)).size,40);
  assert.ok(first.body.people.every(person=>person.memberships?.[0].workspace.id===second));
  assert.equal((await api<Page>('platform/directory?limit=900')).body.people.length,100,'the server bounds a requested page');
  const last=await api<Page>(`platform/directory?workspaceId=${second}&search=Paged&limit=20&offset=120`);
  const exactIds=[first.body.people[0].id,last.body.people.at(-1)!.id];
  const labels=await api<{id:string;name:string}[]>(`platform/people-labels?ids=${exactIds.join(',')}`);
  assert.equal(labels.status,200);assert.deepEqual(labels.body.map(person=>person.id).sort(),exactIds.sort());
  assert.equal((await api('platform/people-labels?ids='+Array(101).fill(editorId).join(','))).status,422);
  assert.equal((await api(`platform/people-labels?ids=${editorId}`,undefined,ADMIN)).status,403);
  const specific=await api<Page>(`platform/directory?personId=${editorId}`);assert.equal(specific.body.people.length,1);assert.equal(specific.body.people[0].memberships?.length,2);
  for(const [portal,id,person] of [[second,'filter-second',editorId],['10000000-0000-0000-0000-000000000101','filter-pilot',operatorId]]){
    await owner(`INSERT INTO public.reporter_ed_productions(portal_id,production_id,doc,seq)
      VALUES($1,$2,jsonb_build_object('createdBy',$3::text,'createdAt',clock_timestamp()),1)`,[portal,id,person]);
    await owner(`INSERT INTO public.reporter_ed_runs(portal_id,run_id,production_id,status,fold,seq)
      VALUES($1,$2,$2,'completed',jsonb_build_object('run',jsonb_build_object('createdBy',$3::text,'model',jsonb_build_object('alias','unpriced-model'),
      'usage',jsonb_build_object('inputTokens',100,'outputTokens',50))),1)`,[portal,id,person]);
  }
  type Usage={totals:{generations:number;inputTokens:number;unpriced:boolean};people:{personId:string}[];workspaces:{workspaceId:string}[];storageIncomplete?:boolean};
  const usage=await api<Usage>(`platform/usage?period=7&workspaceId=${second}&personId=${editorId}`);
  assert.equal(usage.status,200,JSON.stringify(usage.body));assert.equal(usage.body.totals.generations,1);assert.equal(usage.body.totals.inputTokens,100);
  assert.equal(usage.body.totals.unpriced,true);assert.equal(usage.body.storageIncomplete,true);
  assert.deepEqual(usage.body.people.map(item=>item.personId),[editorId]);assert.deepEqual(usage.body.workspaces.map(item=>item.workspaceId),[second]);
  const noMatch=await api<Usage>(`platform/usage?period=7&workspaceId=${second}&personId=${operatorId}`);assert.equal(noMatch.body.totals.generations,0);
  const log=await api<{items:{workspace:{id:string};actor?:{id:string}}[];total:number}>(`platform/log?workspaceId=${second}&personId=${operatorId}&limit=1`);
  assert.equal(log.status,200);assert.equal(log.body.items.length,1);assert.ok(log.body.total>=1);assert.equal(log.body.items[0].workspace.id,second);
});

test('archival keeps the operator integration projection readable while every mutation remains blocked',async()=>{
  const created=await api<{id:string;revision:number}>('platform/workspaces',{name:'Archived integration',slug:'archived-integration'}),workspace=created.body;
  assert.equal((await api('platform/invites',{name:OP.name,email:OP.email,role:'editor',workspaceId:workspace.id})).status,200);
  const [{token_hash:hash}]=await owner('SELECT token_hash FROM core.access_invites WHERE portal_id=$1',[workspace.id]);
  await owner('SELECT public.reporter_invite_accept($1,$2)',[hash,OP.subject]);
  const binding=await api<{id:string;revision:number}>(`platform/workspaces/${workspace.id}/integrations`,{ownerId:operatorId,enabled:true,revision:0});assert.equal(binding.status,201);
  assert.equal((await api(`platform/workspaces/${workspace.id}/update`,{name:'Archived integration',status:'archived',revision:workspace.revision})).status,200);
  const list=await api<{id:string;revision:number;enabled:boolean}[]>(`platform/workspaces/${workspace.id}/integrations`);
  assert.equal(list.status,200,JSON.stringify(list.body));assert.equal(list.body[0].id,binding.body.id);assert.equal(list.body[0].enabled,true);
  assert.ok(!JSON.stringify(list.body).includes('credential'));assert.ok(!JSON.stringify(list.body).includes('token'));
  const edit=await api(`platform/workspaces/${workspace.id}/integrations`,{ownerId:operatorId,enabled:false,revision:binding.body.revision});assert.equal(edit.status,409);
  const unchanged=await api<{enabled:boolean;revision:number}[]>(`platform/workspaces/${workspace.id}/integrations`);assert.equal(unchanged.body[0].enabled,true);assert.equal(unchanged.body[0].revision,1);
});
