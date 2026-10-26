import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg, { type Pool } from 'pg';
import type { ConnectedWorkspace } from '../../src/ports/connected-workspace.ts';
import { startRehearsalDatabase } from '../support/rehearsal-db.ts';

const APP='http://127.0.0.1:3997', PILOT='10000000-0000-0000-0000-000000000101';
const OPERATOR={subject:'workspace-operator',email:'operator@context.test',name:'Operator',image:undefined,emailVerified:true};
const EDITOR={subject:'workspace-editor',email:'editor@context.test',name:'Editor',image:undefined,emailVerified:true};
let db:Awaited<ReturnType<typeof startRehearsalDatabase>>,handle:typeof import('../../src/server/http.ts').handleReporter,second:string,operatorId:string;
async function owner(sql:string,values:unknown[]=[]) {
  const client=new pg.Client({connectionString:db.owner});await client.connect();
  try{return(await client.query(sql,values)).rows;}finally{await client.end();}
}
async function api<T=Record<string,unknown>>(path:string,body?:unknown,identity:typeof OPERATOR|null=EDITOR) {
  const request=new Request(`${APP}/api/reporter/${path}`,body===undefined?undefined:{method:'POST',headers:{origin:APP,'content-type':'application/json'},body:JSON.stringify(body)});
  const response=await handle(request,path.split('?')[0].split('/'),{identify:async()=>identity,defer:()=>{}});
  return{status:response.status,body:await response.json() as T};
}
before(async()=>{
  db=await startRehearsalDatabase([{email:OPERATOR.email,role:'admin'},{email:EDITOR.email,role:'editor'}]);
  await owner('UPDATE core.users SET auth_subject=CASE WHEN email=$1 THEN $2 ELSE $3 END,email_verified=true',[OPERATOR.email,OPERATOR.subject,EDITOR.subject]);
  [{id:operatorId}]=await owner('SELECT id FROM core.users WHERE email=$1',[OPERATOR.email]);
  await owner("INSERT INTO public.user_roles(user_id,role) VALUES($1,'platform_admin')",[operatorId]);
  Object.assign(process.env,{REPORTER_DEPLOYMENT_MODE:'cloud',REPORTER_DATABASE_URL:db.runtime,REPORTER_WORKER_DATABASE_URL:db.worker,
    REPORTER_DEFAULT_PORTAL_ID:PILOT,REPORTER_WORKSPACES_MODE:'all'});
  ({handleReporter:handle}=await import('../../src/server/http.ts'));
  const created=await api<{id:string;revision:number}>('platform/workspaces',{name:'Second client',slug:'second-context'},OPERATOR);
  assert.equal(created.status,201);second=created.body.id;
  await api(`platform/workspaces/${second}/update`,{name:'Second client',status:'active',revision:created.body.revision},OPERATOR);
  await api('platform/invites',{name:EDITOR.name,email:EDITOR.email,role:'approver',workspaceId:second},OPERATOR);
  const [{token_hash:hash}]=await owner('SELECT token_hash FROM core.access_invites WHERE portal_id=$1',[second]);
  await owner('SELECT public.reporter_invite_accept($1,$2)',[hash,EDITOR.subject]);
},{timeout:180000});
after(async()=>{
  const pools=(globalThis as typeof globalThis & {reporterPools?:Partial<Record<string,Pool>>}).reporterPools??{};
  await Promise.all(Object.values(pools).map(pool=>pool?.end()));db?.stop();
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
