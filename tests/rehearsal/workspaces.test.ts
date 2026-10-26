import assert from 'node:assert/strict';
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
