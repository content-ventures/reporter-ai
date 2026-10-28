import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg, { type Pool } from 'pg';
import { startRehearsalDatabase } from '../support/rehearsal-db.ts';
import type { MemoryBlock, MemoryMaterial, MemoryPage } from '../../src/domain/editorial-memory.ts';
import { resolveMemoryAnchor } from '../../src/domain/editorial-memory.ts';
import type { MemoryJob } from '../../src/ports/editorial-memory.ts';
import type { Source } from '../../src/domain/source.ts';

const APP = 'http://127.0.0.1:3992';
const identities = ['editor', 'approver'].map(role => ({ subject: `materials-${role}`, email: `${role}@materials.test`, name: role, emailVerified: true }));
let db: Awaited<ReturnType<typeof startRehearsalDatabase>>;
const metadata = { publishedOn: null, recordedOn: null, institution: null, company: null, event: null, edition: null, topics: [], originalUrl: null };
const text = ' '.repeat(3) + 'Relatório sintético: foram atendidas 240 pessoas em 2025.\r\n' + 'a'.repeat(940) + '😀 é\n' + 'Conteúdo preservado sem resumir. '.repeat(80);
const input = { title: 'Synthetic intake', kind: 'report', text, authorized: true, metadata, primaryOrigin: null, originalFileId: null };
async function owner(sql: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: db.owner }); await client.connect();
  try { return (await client.query(sql, values)).rows; } finally { await client.end(); }
}
async function api(path: string, value?: unknown, key = randomUUID(), identity: typeof identities[number] | null = identities[0], origin = APP) {
  const { handleReporter } = await import('../../src/server/http.ts'), url = new URL(`${APP}/api/reporter/w/reporter-ai/memory/${path}`);
  return handleReporter(new Request(url, value === undefined ? {} : { method: 'POST', headers: { origin, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(value) }),
    ['w', 'reporter-ai', 'memory', ...url.pathname.split('/').slice(6)], { identify: async () => identity });
}
before(async () => {
  db = await startRehearsalDatabase(identities.map((identity, index) => ({ email: identity.email, role: index === 0 ? 'editor' : 'approver' })));
  for (const identity of identities) await owner('UPDATE core.users SET auth_subject=$2,email_verified=true WHERE email=$1', [identity.email, identity.subject]);
  Object.assign(process.env, { REPORTER_DEPLOYMENT_MODE: 'cloud', REPORTER_DATABASE_URL: db.runtime, REPORTER_WORKER_DATABASE_URL: db.worker,
    REPORTER_DEFAULT_PORTAL_ID: '10000000-0000-0000-0000-000000000101', REPORTER_WORKSPACES_MODE: 'all', REPORTER_APP_ORIGINS: APP,
    REPORTER_MEMORY_MODE: 'on', REPORTER_WORKER_PASSWORD: db.workerPassword });
}, { timeout: 180000 });
after(async () => {
  const pools = (globalThis as typeof globalThis & { reporterPools?: Partial<Record<string, Pool>> }).reporterPools ?? {};
  await Promise.all(Object.values(pools).map(pool => pool?.end())); db?.stop();
});

test('HTTP imports one immutable original, complete Unicode blocks and authenticated idempotent provenance', async () => {
  const key = randomUUID(), response = await api('materials', input, key);
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json() as { material: MemoryMaterial; job: MemoryJob };
  assert.deepEqual(await (await api('materials', input, key)).json(), result);
  assert.equal((await api('materials', { ...input, title: 'Changed' }, key)).status, 409);
  const detailResponse = await api(`materials/${result.material.id}`);
  assert.equal(detailResponse.headers.get('cache-control'), 'private, no-store');
  const detail = await detailResponse.json() as { material: MemoryMaterial; source: Source; job: MemoryJob };
  assert.equal(detail.source.versions[0].content.type, 'transcript');
  assert.equal(detail.source.versions[0].content.segments[0].text, text);
  assert.deepEqual(detail.material.metadata, metadata);
  assert.deepEqual(detail.source.speakers, []);
  const blocks: MemoryBlock[] = []; let cursor: string | null = null;
  do {
    const page = await (await api(`jobs/${result.job.id}/blocks?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)).json() as MemoryPage<MemoryBlock>;
    assert.equal(page.total, Math.ceil(text.length / 1000)); blocks.push(...page.items); cursor = page.nextCursor;
  } while (cursor);
  assert.equal(blocks.map(block => block.anchor.excerpt).join(''), text);
  for (const block of blocks) assert.equal(resolveMemoryAnchor(detail.source, block.anchor), block.anchor.excerpt);
  assert.equal(detail.job.totalBlocks, blocks.length); assert.equal(detail.job.completedBlocks, 0); assert.equal(detail.job.evidenceCount, 0);
  const [audit] = await owner("SELECT user_id,after_data FROM public.audit_log WHERE action='memory.material.import' AND after_data->'material'->>'id'=$1", [result.material.id]);
  assert.equal(audit.user_id, detail.material.importedBy); assert.equal(detail.job.createdBy, audit.user_id);
  const [count] = await owner("SELECT count(*)::integer AS amount FROM public.reporter_memory_heads WHERE kind='material'"); assert.equal(count.amount, 1);
  assert.equal((await api(`jobs/${result.job.id}/blocks?unknown=1`)).status, 422);
});

test('material and block cursors bind resource, user and snapshot; original files and mutations stay scoped', async () => {
  await api('materials', { ...input, title: 'Second synthetic material' });
  const page = await (await api('materials?limit=1')).json() as MemoryPage<MemoryMaterial & { job: MemoryJob }>;
  assert.equal(page.total, 2); assert.ok(page.nextCursor);
  await api('materials', { ...input, title: 'Later synthetic material' });
  const tail = await (await api(`materials?limit=1&cursor=${encodeURIComponent(page.nextCursor!)}`)).json() as MemoryPage<MemoryMaterial>;
  assert.equal(tail.total, 2); assert.notEqual(tail.items[0].id, page.items[0].id); assert.equal(tail.nextCursor, null);
  assert.equal((await api(`jobs/${page.items[0].job.id}/blocks?limit=1&cursor=${encodeURIComponent(page.nextCursor!)}`)).status, 409);
  assert.equal((await api(`materials?limit=1&cursor=${encodeURIComponent(page.nextCursor!)}`, undefined, randomUUID(), identities[1])).status, 409);
  assert.equal((await api('materials', input, randomUUID(), identities[1])).status, 403);
  assert.equal((await api('materials', input, randomUUID(), null)).status, 401);
  assert.equal((await api('materials', input, randomUUID(), identities[0], 'https://foreign.invalid')).status, 403);
  assert.equal((await api('materials', { ...input, originalFileId: randomUUID() })).status, 403);
  assert.equal((await api('materials', { ...input, importedBy: randomUUID() })).status, 422);
  assert.equal((await api('jobs/unknown')).status, 404);
});

test('cancel and retry retain completed blocks, invalidate generations and audit exact mutations', async () => {
  const { job } = await (await api('materials', input)).json() as { job: MemoryJob };
  const [completed] = await owner("UPDATE public.reporter_memory_heads SET doc=doc||'{\"status\":\"completed\",\"attempts\":1}'::jsonb WHERE kind='block' AND doc->>'jobId'=$1 AND doc->>'ordinal'='0' RETURNING id,doc", [job.id]);
  // Owner fixture mirrors a persisted successful worker result, including immutable history.
  await owner('INSERT INTO public.reporter_memory_history SELECT * FROM public.reporter_memory_heads WHERE kind=$1 AND id=$2 ON CONFLICT DO NOTHING', ['block', completed.id]);
  await owner("UPDATE public.reporter_memory_history SET doc=$2 WHERE kind='block' AND id=$1", [completed.id, JSON.stringify(completed.doc)]);
  const cancelledResponse = await api(`jobs/${job.id}/cancel`, { baseRevision: job.revision });
  assert.equal(cancelledResponse.status, 200, await cancelledResponse.clone().text());
  const cancelled = await cancelledResponse.json() as MemoryJob;
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.generation, 2); assert.equal(cancelled.completedBlocks, 1);
  assert.equal((await api(`jobs/${job.id}/cancel`, { baseRevision: job.revision })).status, 409);
  const key = randomUUID(), retried = await (await api(`jobs/${job.id}/retry`, {}, key)).json() as MemoryJob;
  assert.equal(retried.status, 'queued'); assert.equal(retried.generation, 3); assert.equal(retried.completedBlocks, 1);
  assert.deepEqual(await (await api(`jobs/${job.id}/retry`, {}, key)).json(), retried);
  const blocks = await (await api(`jobs/${job.id}/blocks`)).json() as MemoryPage<MemoryBlock>;
  assert.deepEqual(blocks.items[0], completed.doc); assert.ok(blocks.items.slice(1).every(block => block.status === 'pending' && block.attempts === 0));
  const audits = await owner("SELECT action,user_id FROM public.audit_log WHERE entity_type='memory_job' AND after_data->>'id'=$1 ORDER BY created_at", [job.id]);
  assert.deepEqual(audits.map(audit => audit.action), ['memory.job.cancel', 'memory.job.retry']);
  assert.ok(audits.every(audit => audit.user_id === job.createdBy));
});
