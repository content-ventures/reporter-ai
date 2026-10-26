import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg from 'pg';
import type { ManagedWorkspace } from '../../src/domain/workspace-management.ts';
import { startRehearsalDatabase } from '../support/rehearsal-db.ts';

const PILOT = '10000000-0000-0000-0000-000000000101';
let db: Awaited<ReturnType<typeof startRehearsalDatabase>>, actor: string, editor: string, baseline: string;
const migration = 'database/migrations/030-workspace-lifecycle.sql';

async function owner(sql: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: db.owner });
  await client.connect();
  try { return (await client.query(sql, values)).rows; } finally { await client.end(); }
}
async function platform<T>(sql: string, values: unknown[] = [], person = actor): Promise<T> {
  const client = new pg.Client({ connectionString: db.runtime });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.access_mode','platform',true),set_config('app.user_id',$1,true)", [person]);
    const { rows } = await client.query(sql, values);
    await client.query('COMMIT');
    return rows[0]?.value as T;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { await client.end(); }
}

async function fingerprint() {
  return JSON.stringify(await owner(`SELECT 'portal' AS kind,md5(to_jsonb(p)::text) AS hash FROM public.portals p WHERE id=$1
    UNION ALL SELECT 'workspace',md5(doc::text) FROM public.reporter_ed_workspace WHERE portal_id=$1
    UNION ALL SELECT 'production',md5(doc::text) FROM public.reporter_ed_productions WHERE portal_id=$1
    UNION ALL SELECT 'pipeline',md5(doc::text) FROM public.reporter_ed_pipelines WHERE portal_id=$1
    UNION ALL SELECT 'membership',md5((to_jsonb(m)-'revision'-'invite_pending')::text) FROM public.portal_members m WHERE portal_id=$1
    UNION ALL SELECT 'role',md5(to_jsonb(r)::text) FROM public.portal_user_roles r WHERE portal_id=$1 ORDER BY kind,hash`, [PILOT]));
}

before(async () => {
  db = await startRehearsalDatabase([{ email: 'operator@workspace.test', role: 'admin' }, { email: 'editor@workspace.test', role: 'editor' }], { beforeMigration: migration });
  const users = await owner('SELECT id,email FROM core.users');
  actor = users.find(u => u.email === 'operator@workspace.test')!.id;
  editor = users.find(u => u.email === 'editor@workspace.test')!.id;
  await owner("INSERT INTO public.user_roles(user_id,role) VALUES($1,'platform_admin')", [actor]);
  await owner(`WITH workspace AS (INSERT INTO public.reporter_ed_workspace(portal_id,doc,seq) VALUES($1,'{"workspace":{"id":"pilot"},"pipelineHash":"preserved"}',1)),
    production AS (INSERT INTO public.reporter_ed_productions(portal_id,production_id,doc,seq) VALUES($1,'preserved','{"title":"Historical draft"}',1))
    INSERT INTO public.reporter_ed_pipelines(portal_id,hash,doc) VALUES($1,'preserved','{"revision":5,"definition":{"editorial":{"map":{"audience":"Pilot audience"},"guide":{"voice":"Pilot voice"}}}}')`, [PILOT]);
  baseline = await fingerprint();
  db.migrate();
}, { timeout: 180000 });
after(() => db?.stop());

test('adopting and replaying preserve the pilot portal and every existing content/configuration row', async () => {
  assert.equal(await fingerprint(), baseline);
  db.migrate();
  assert.equal(await fingerprint(), baseline);
  assert.deepEqual(await owner('SELECT portal_id FROM public.reporter_workspaces WHERE pilot'), [{ portal_id: PILOT }]);
});

test('only a platform operator creates clients, with independent identity and empty readiness', async () => {
  await assert.rejects(platform('SELECT public.reporter_workspace_create($1,$2) AS value', ['Other client', 'other-client'], editor), { code: '42501' });
  const value = await platform<ManagedWorkspace>('SELECT public.reporter_workspace_create($1,$2) AS value', ['Other client', 'other-client']);
  assert.equal(value.status, 'draft');
  assert.equal(value.pilot, false);
  assert.deepEqual(value.readiness.missing, ['editorial_map', 'writing_guide', 'templates', 'editor', 'approver']);
  assert.notEqual(value.id, PILOT);
  assert.equal((await owner('SELECT count(*)::integer AS count FROM public.reporter_ed_productions WHERE portal_id=$1', [value.id]))[0].count, 0);
  await assert.rejects(platform('SELECT public.reporter_workspace_create($1,$2) AS value', ['Duplicate', 'other-client']), { message: 'SLUG_TAKEN' });
  await assert.rejects(platform('SELECT public.reporter_workspace_create($1,$2) AS value', ['Reserved', 'platform']), { message: 'INVALID_SLUG' });
});

test('lifecycle changes use optimistic revision and archival waits for owned jobs without deleting history', async () => {
  let value = await platform<ManagedWorkspace>('SELECT public.reporter_workspace_create($1,$2) AS value', ['Lifecycle client', 'lifecycle-client']);
  value = await platform<ManagedWorkspace>('SELECT public.reporter_workspace_update($1,$2,$3,$4) AS value', [value.id, 'Renamed client', 'active', value.revision]);
  assert.deepEqual([value.name, value.slug, value.status, value.revision], ['Renamed client', 'lifecycle-client', 'active', 2]);
  await assert.rejects(platform('SELECT public.reporter_workspace_update($1,$2,$3,$4) AS value', [value.id, 'Stale', 'archived', 1]), { message: 'CONFLICT' });
  await owner(`WITH production AS (INSERT INTO public.reporter_ed_productions(portal_id,production_id,doc,seq) VALUES($1,'job-production','{}',1))
    INSERT INTO public.reporter_ed_runs(portal_id,run_id,production_id,status,job,fold,seq) VALUES($1,'job','job-production','queued','{}','{}',1)`, [value.id]);
  value = await platform<ManagedWorkspace>('SELECT public.reporter_workspace_update($1,$2,$3,$4) AS value', [value.id, value.name, 'archived', value.revision]);
  assert.equal(value.status, 'archiving');
  await owner("UPDATE public.reporter_ed_runs SET status='completed',job=NULL WHERE portal_id=$1", [value.id]);
  value = await platform<ManagedWorkspace>('SELECT public.reporter_workspace_update($1,$2,$3,$4) AS value', [value.id, value.name, 'archived', value.revision]);
  assert.equal(value.status, 'archived');
  value = await platform<ManagedWorkspace>('SELECT public.reporter_workspace_update($1,$2,$3,$4) AS value', [value.id, value.name, 'active', value.revision]);
  assert.equal(value.status, 'active');
  assert.equal((await owner('SELECT count(*)::integer AS count FROM public.reporter_ed_runs WHERE portal_id=$1', [value.id]))[0].count, 1);
  assert.equal(await fingerprint(), baseline);
});

test('composite constraints reject a foreign workspace role and a role without the matching membership', async () => {
  const workspace = await platform<ManagedWorkspace>('SELECT public.reporter_workspace_create($1,$2) AS value', ['Role boundary', 'role-boundary']);
  const [{ id: role }] = await owner("SELECT id FROM public.portal_roles WHERE portal_id=$1 AND name='approver'", [workspace.id]);
  await assert.rejects(owner('INSERT INTO public.portal_user_roles(portal_id,user_id,portal_role_id) VALUES($1,$2,$3)', [PILOT, editor, role]), { code: '23503' });
  await assert.rejects(owner('INSERT INTO public.portal_user_roles(portal_id,user_id,portal_role_id) VALUES($1,$2,$3)', [workspace.id, editor, role]), { code: '23503' });
});

async function archiveTurn(portal:string){
  const client=new pg.Client({connectionString:db.worker});await client.connect();
  try{
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.access_mode','job',true),set_config('app.job_key','reporter-ai-processing',true)");
    const lease=(await client.query("SELECT public.reporter_worker_next('archive-lifecycle-worker','any') AS value")).rows[0].value;
    assert.equal(lease.portal,portal);
    await client.query("SELECT set_config('app.portal_id',$1,true)",[portal]);
    assert.equal((await client.query('SELECT public.reporter_worker_archive_maintenance() AS value')).rows[0].value,true);
    assert.equal((await client.query('SELECT public.reporter_worker_dispatch_release($1,$2,$3) AS value',[portal,lease.dispatch.owner,lease.dispatch.fence])).rows[0].value,true);
    await client.query('COMMIT');
  }finally{await client.end();}
}

test('archival settles expired uploads and retains dead letters and sources without creating new collection',async()=>{
  let workspace=await platform<ManagedWorkspace>('SELECT public.reporter_workspace_create($1,$2) AS value',['Archival uploads','archival-uploads']);
  workspace=await platform<ManagedWorkspace>('SELECT public.reporter_workspace_update($1,$2,$3,$4) AS value',[workspace.id,workspace.name,'active',workspace.revision]);
  const [{tenant_id:tenant}]=await owner('SELECT tenant_id FROM public.portals WHERE id=$1',[workspace.id]);
  const source=randomUUID(),transcript=randomUUID();
  await owner(`INSERT INTO core.storage_objects(id,tenant_id,portal_id,owner_user_id,purpose,provider,visibility,key,file_name,reference,size,content_type,store_id)
    VALUES($1,$2,$3,$4,'reporter-source','s3','private',$5,'expired.mp3',jsonb_build_object('upload_expires_at',clock_timestamp()-interval '1 hour'),1,'audio/mpeg','reporter-source-media')`,[source,tenant,workspace.id,actor,`incoming/${workspace.id}/${source}.mp3`]);
  await owner('INSERT INTO public.reporter_transcripts(id,portal_id,source_object_id,created_by) VALUES($1,$2,$3,$4)',[transcript,workspace.id,source,actor]);
  await owner("INSERT INTO core.integration_outbox(tenant_id,portal_id,module,event_type,aggregate_id,attempts,last_error) VALUES($1,$2,'reporter_ai','reporter.transcription.requested',$3,8,'ATTEMPTS_EXHAUSTED')",[tenant,workspace.id,randomUUID()]);
  await owner("INSERT INTO public.reporter_news_sources(portal_id,kind,name,url,canonical_url,every_minutes) VALUES($1,'rss','Stopped collection','https://archive.test/rss','https://archive.test/rss',60)",[workspace.id]);
  workspace=await platform<ManagedWorkspace>('SELECT public.reporter_workspace_update($1,$2,$3,$4) AS value',[workspace.id,workspace.name,'archived',workspace.revision]);
  assert.equal(workspace.status,'archiving');
  await archiveTurn(workspace.id);
  assert.equal((await owner('SELECT lifecycle FROM public.reporter_workspaces WHERE portal_id=$1',[workspace.id]))[0].lifecycle,'archived');
  assert.equal((await owner('SELECT error_code FROM public.reporter_transcripts WHERE id=$1',[transcript]))[0].error_code,'UPLOAD_EXPIRED');
  assert.equal((await owner('SELECT count(*)::int AS count FROM core.storage_objects WHERE id=$1',[source]))[0].count,1);
  assert.equal((await owner('SELECT count(*)::int AS count FROM core.integration_outbox WHERE portal_id=$1',[workspace.id]))[0].count,1,'the historical dead letter is retained');
});

test('optional work on a completed article prevents archival until it settles',async()=>{
  let workspace=await platform<ManagedWorkspace>('SELECT public.reporter_workspace_create($1,$2) AS value',['Archival images','archival-images']);
  workspace=await platform<ManagedWorkspace>('SELECT public.reporter_workspace_update($1,$2,$3,$4) AS value',[workspace.id,workspace.name,'active',workspace.revision]);
  await owner(`WITH production AS (INSERT INTO public.reporter_ed_productions(portal_id,production_id,doc,seq) VALUES($1,'image-production','{}',1))
    INSERT INTO public.reporter_ed_runs(portal_id,run_id,production_id,status,job,fold,seq) VALUES($1,'image-run','image-production','completed','{"images":{"status":"queued"}}','{}',1)`,[workspace.id]);
  workspace=await platform<ManagedWorkspace>('SELECT public.reporter_workspace_update($1,$2,$3,$4) AS value',[workspace.id,workspace.name,'archived',workspace.revision]);
  assert.equal(workspace.status,'archiving');
  await owner("UPDATE public.reporter_ed_runs SET job=jsonb_set(job,'{images,status}','\"completed\"') WHERE portal_id=$1",[workspace.id]);
  await archiveTurn(workspace.id);
  assert.equal((await owner('SELECT lifecycle FROM public.reporter_workspaces WHERE portal_id=$1',[workspace.id]))[0].lifecycle,'archived');
});
