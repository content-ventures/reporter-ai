import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg, { type Pool } from 'pg';
import { startRehearsalDatabase } from '../support/rehearsal-db.ts';
import { runWithWorkerContext, requireWorkerContext } from '../../src/server/worker-context.ts';
import { withWorkspaceWork } from '../../src/server/worker-dispatch.ts';
import { transaction } from '../../src/server/database.ts';

let db:Awaited<ReturnType<typeof startRehearsalDatabase>>,admin:pg.Client;
const clients:Array<{tenant:string;portal:string;event:string}>=[];
const signal=()=>new AbortController().signal;
const sql=async<T>(query:string,values:unknown[]=[])=>transaction('worker',async client=>(await client.query(query,values)).rows[0]?.value as T);
before(async()=>{
  db=await startRehearsalDatabase([]);admin=new pg.Client({connectionString:db.owner});await admin.connect();
  Object.assign(process.env,{REPORTER_DEPLOYMENT_MODE:'cloud',REPORTER_DATABASE_URL:db.runtime,REPORTER_WORKER_DATABASE_URL:db.worker});
  for(let i=0;i<6;i++){
    const tenant=randomUUID(),portal=randomUUID(),event=randomUUID();clients.push({tenant,portal,event});
    await admin.query('INSERT INTO core.tenants(id,slug,name) VALUES($1,$2,$2)',[tenant,'worker-client-'+i]);
    await admin.query("INSERT INTO core.tenant_modules VALUES($1,'reporter_ai',true)",[tenant]);
    await admin.query('INSERT INTO public.portals(id,tenant_id,slug,name) VALUES($1,$2,$3,$3)',[portal,tenant,'worker-client-'+i]);
    await admin.query("INSERT INTO core.portal_modules VALUES($1,$2,'reporter_ai',true)",[tenant,portal]);
    await admin.query("INSERT INTO public.reporter_workspaces(portal_id,lifecycle) VALUES($1,'active')",[portal]);
    await admin.query("INSERT INTO core.integration_outbox(id,tenant_id,portal_id,module,event_type,aggregate_id,payload) VALUES($1,$2,$3,'reporter_ai','reporter.transcription.requested',$4,'{}')",[event,tenant,portal,randomUUID()]);
  }
},{timeout:180000});
after(async()=>{
  const pools=(globalThis as typeof globalThis & {reporterPools?:Partial<Record<string,Pool>>}).reporterPools??{};
  await Promise.all(Object.values(pools).map(pool=>pool?.end().catch(()=>{})));
  await admin?.end();db?.stop();
});

test('an unscoped worker discovers work without adopting any default workspace',async()=>{
  assert.equal(await sql('SELECT public.reporter_worker_pending() AS value'),true);
  await assert.rejects(sql('SELECT public.reporter_claim($1) AS value',['no-context-worker']),{code:'42501'});
  await assert.rejects(sql('SELECT public.reporter_ed_claim($1,$2) AS value',['no-context-worker',60000]),{code:'42501'});
});

test('global dispatch caps four clients and a live client cannot be selected twice',async()=>{
  const leases=await Promise.all(Array.from({length:6},(_,i)=>sql<{portal:string;dispatch:{owner:string;fence:string}}|null>(
    'SELECT public.reporter_worker_next($1,$2) AS value',['parallel-worker-'+i,'outbox'])));
  const active=leases.filter(item=>item!==null);
  assert.equal(active.length,4);assert.equal(new Set(active.map(item=>item.portal)).size,4);
  for(const item of active) assert.equal(await sql('SELECT public.reporter_worker_dispatch_release($1,$2,$3) AS value',[item.portal,item.dispatch.owner,item.dispatch.fence]),true);
});

test('successive turns serve every eligible client before repeating a busy one; queued work stays scoped',async()=>{
  await admin.query("UPDATE public.reporter_worker_dispatches SET last_served_at='-infinity'");
  const visited:string[]=[];
  for(let i=0;i<6;i++){
    assert.equal(await withWorkspaceWork('outbox','fairness-worker',signal(),async()=>{
      const context=requireWorkerContext();visited.push(context.portal);
      assert.equal(await sql("SELECT nullif(current_setting('app.portal_id',true),'') AS value"),context.portal);
      const event=await sql<{id:string;portal_id:string;tenant_id:string}>('SELECT to_jsonb(c) AS value FROM public.reporter_claim($1) c',['fairness-worker']);
      assert.equal(event.portal_id,context.portal);assert.equal(event.tenant_id,context.tenant);
      assert.equal(event.id,clients.find(client=>client.portal===context.portal)!.event);
      // Leave the task eligible, as a durable retry would, without changing its owner.
      await admin.query('UPDATE core.integration_outbox SET lease_owner=NULL,lease_until=NULL WHERE id=$1',[event.id]);
      return true;
    }),true);
  }
  assert.equal(new Set(visited).size,6);
});

test('expired dispatches recover after restart and stale renewal/release cannot take the new lease',async()=>{
  const old=await sql<{portal:string;tenant:string;dispatch:{owner:string;fence:string}}>('SELECT public.reporter_worker_next($1,$2) AS value',['restarted-worker','outbox']);
  await admin.query("UPDATE public.reporter_worker_dispatches SET lease_until=clock_timestamp()-interval '1 second',last_served_at='-infinity' WHERE portal_id=$1",[old.portal]);
  const current=await sql<typeof old>('SELECT public.reporter_worker_next($1,$2) AS value',['replacement-worker','outbox']);
  assert.equal(current.portal,old.portal);assert.notEqual(current.dispatch.fence,old.dispatch.fence);
  for(const action of ['renew','release']) assert.equal(await sql(`SELECT public.reporter_worker_dispatch_${action}($1,$2,$3) AS value`,[old.portal,old.dispatch.owner,old.dispatch.fence]),false);
  assert.equal(await sql('SELECT public.reporter_worker_dispatch_release($1,$2,$3) AS value',[current.portal,current.dispatch.owner,current.dispatch.fence]),true);
});

test('a daily dispatch ceiling pauses only its client, survives a restart and resets in UTC',async()=>{
  const client=clients[0],other=clients[1];
  await admin.query("UPDATE public.reporter_workspaces SET lifecycle='archived' WHERE portal_id=ANY($1)",[clients.map(item=>item.portal)]);
  await admin.query("UPDATE public.reporter_workspaces SET lifecycle='active',settings=$2::jsonb WHERE portal_id=$1",[client.portal,JSON.stringify({processing:{dailyLimit:1}})]);
  await admin.query('DELETE FROM public.reporter_worker_usage WHERE portal_id=$1',[client.portal]);
  try{
    assert.equal(await withWorkspaceWork('outbox','budget-worker-first',signal(),async()=>true),true);
    assert.equal(await withWorkspaceWork('outbox','budget-worker-restarted',signal(),async()=>true),false);
    assert.equal(await sql('SELECT public.reporter_worker_pending() AS value'),false);
    assert.equal((await admin.query('SELECT processed_at FROM core.integration_outbox WHERE id=$1',[client.event])).rows[0].processed_at,null,'the waiting task is retained');
    await admin.query("UPDATE public.reporter_workspaces SET lifecycle='active' WHERE portal_id=$1",[other.portal]);
    assert.equal(await withWorkspaceWork('outbox','budget-other-client',signal(),async()=>requireWorkerContext().portal),other.portal);
    await admin.query("UPDATE public.reporter_workspaces SET lifecycle='archived' WHERE portal_id=$1",[other.portal]);
    await admin.query("UPDATE public.reporter_worker_usage SET day=day-1 WHERE portal_id=$1",[client.portal]);
    assert.equal(await withWorkspaceWork('outbox','budget-worker-next-day',signal(),async()=>true),true);
  }finally{
    await admin.query("UPDATE public.reporter_workspaces SET lifecycle='active',settings=settings-'processing' WHERE portal_id=ANY($1)",[clients.map(item=>item.portal)]);
  }
});

test('disabled modules and archived clients are excluded while archiving clients can settle owned work',async()=>{
  await admin.query("UPDATE public.reporter_workspaces SET lifecycle='archived' WHERE portal_id=ANY($1)",[clients.map(client=>client.portal)]);
  assert.equal(await sql('SELECT public.reporter_worker_pending() AS value'),false);
  const client=clients[0];
  await admin.query("UPDATE public.reporter_workspaces SET lifecycle='archiving' WHERE portal_id=$1",[client.portal]);
  await admin.query("UPDATE public.portals SET status='archiving' WHERE id=$1",[client.portal]);
  assert.equal(await withWorkspaceWork('outbox','archive-worker',signal(),async()=>requireWorkerContext().portal),client.portal);
  await admin.query('UPDATE core.portal_modules SET enabled=false WHERE portal_id=$1',[client.portal]);
  assert.equal(await sql('SELECT public.reporter_worker_next($1,$2) AS value',['disabled-worker','outbox']),null);
  await runWithWorkerContext(client,async()=>assert.equal(await sql('SELECT public.reporter_worker_pending() AS value'),false));
});
