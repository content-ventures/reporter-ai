import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg, { type Pool } from 'pg';
import type { MemoryBatch, MemoryBatchItemInput } from '../../src/ports/editorial-memory-batch.ts';
import { startRehearsalDatabase } from '../support/rehearsal-db.ts';
import { startFakeS3 } from '../support/fake-s3.ts';
import { startWorkerHost } from '../support/worker-host.ts';
import { exerciseMemoryBatchBrowser } from '../support/editorial-memory-batch-browser.ts';

const APP = process.env.REPORTER_MEMORY_BATCH_UI_BASE ?? 'http://127.0.0.1:3997', PORTAL = '10000000-0000-0000-0000-000000000101';
const identities = ['editor', 'peer', 'approver', 'admin'].map(role => ({ subject: `batch-${role}`, email: `${role}@batches.test`, name: role, emailVerified: true }));
const bytes = Buffer.from('\ufeffDocumento sintético: em 2025 foram observadas 240 pessoas. Não representa uma pesquisa real.\r\n');
const metadata = { publishedOn: null, recordedOn: null, institution: null, company: null, event: null, edition: null, topics: [], originalUrl: null };
const descriptor = (body = bytes, name = 'Original — sintético.txt'): MemoryBatchItemInput => ({ id: randomUUID(),
  file: { name, size: body.length, checksum: createHash('sha256').update(body).digest('hex'), delimiter: null },
  input: { title: 'Synthetic batch document', kind: 'archive', metadata, primaryOrigin: 'synthetic:batch', authorized: true } });
let db: Awaited<ReturnType<typeof startRehearsalDatabase>>, storage: Awaited<ReturnType<typeof startFakeS3>>, host: Awaited<ReturnType<typeof startWorkerHost>>;
let handle: typeof import('../../src/server/http.ts').handleReporter, refuseStorage = false;
async function owner(sql: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: db.owner }); await client.connect();
  try { return (await client.query(sql, values)).rows; } finally { await client.end(); }
}
async function api(path: string, input?: unknown, actor = 0, key: string = randomUUID(), slug = 'reporter-ai') {
  return handle(new Request(`${APP}/api/reporter/w/${slug}/memory/${path}`, input === undefined ? {} : { method: 'POST',
    headers: { origin: APP, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(input) }),
  ['w', slug, 'memory', ...path.split('?')[0].split('/')], { identify: async () => identities[actor], defer: () => {} });
}
async function ok<T>(path: string, input?: unknown, actor = 0, key?: string, slug?: string): Promise<T> {
  const response = await api(path, input, actor, key, slug); assert.equal(response.status, 200, await response.clone().text()); return response.json() as Promise<T>;
}
const create = (items: MemoryBatchItemInput[], key?: string) => ok<MemoryBatch>('batches', { title: 'Synthetic historical batch', items }, 0, key);
const upload = (batch: MemoryBatch, position = 0, body = bytes, actor = 0, key?: string) => ok<MemoryBatch>(`batches/${batch.id}/items/${batch.items[position].id}/upload`,
  { revision: batch.items[position].revision, bytes: body.toString('base64') }, actor, key);
const processItem = (batch: MemoryBatch, position = 0, actor = 0, key?: string) => ok<MemoryBatch>(`batches/${batch.id}/items/${batch.items[position].id}/process`,
  { revision: batch.items[position].revision }, actor, key);
before(async () => {
  db = await startRehearsalDatabase(identities.map((identity, index) => ({ email: identity.email, role: ['editor', 'editor', 'approver', 'admin'][index] })));
  for (const identity of identities) await owner('UPDATE core.users SET auth_subject=$2,email_verified=true WHERE email=$1', [identity.email, identity.subject]);
  Object.assign(process.env, { REPORTER_DEPLOYMENT_MODE: 'cloud', REPORTER_DATABASE_URL: db.runtime, REPORTER_WORKER_DATABASE_URL: db.worker,
    REPORTER_WORKER_PASSWORD: db.workerPassword, REPORTER_DEFAULT_PORTAL_ID: PORTAL, REPORTER_WORKSPACES_MODE: 'all', REPORTER_APP_ORIGINS: APP, REPORTER_MEMORY_MODE: 'on' });
  storage = await startFakeS3({ bucket: 'reporter-source-media', corsOrigins: [] });
  Object.assign(process.env, { AWS_ENDPOINT_URL_S3: storage.endpoint, AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'synthetic-access-key', AWS_SECRET_ACCESS_KEY: 'synthetic-secret-key' });
  const { createReporterWorker } = await import('../../functions/reporter-worker.ts'), worker = createReporterWorker();
  host = await startWorkerHost({ fetch: request => refuseStorage && new URL(request.url).pathname === '/memory-objects'
    ? Promise.resolve(Response.json({ error: 'SYNTHETIC_STORAGE_FAILURE' }, { status: 503 })) : worker.fetch(request) });
  process.env.REPORTER_WORKER_URL = host.url; ({ handleReporter: handle } = await import('../../src/server/http.ts'));
}, { timeout: 180000 });
after(async () => {
  try { await Promise.all([host?.stop(), storage?.stop()]); }
  finally { const pools = (globalThis as typeof globalThis & { reporterPools?: Partial<Record<string, Pool>> }).reporterPools ?? {};
    await Promise.all(Object.values(pools).map(pool => pool?.end())); db?.stop(); }
});

test('batch manifests persist every preflight refusal and retain actual owner and stable request identity', async () => {
  const valid = descriptor(), unsupported = descriptor(bytes, 'scan.pdf'), large = descriptor(); large.file.size = 1048577; large.file.checksum = null;
  const key = randomUUID(), batch = await create([valid, unsupported, large], key);
  assert.deepEqual(batch.items.map(item => item.status), ['needs_file', 'refused', 'refused']);
  assert.deepEqual(batch.items.slice(1).map(item => item.issue!.code), ['unsupported_type', 'too_large']);
  assert.equal((await create([valid, unsupported, large], key)).id, batch.id);
  assert.equal((await api('batches', { title: 'Changed', items: [valid] }, 0, key)).status, 409);
  assert.equal((await api('batches', { title: 'Forged', items: [valid], createdBy: identities[3].subject })).status, 422);
  assert.equal((await api(`batches/${batch.id}`, undefined, 1)).status, 404);
  assert.equal((await api(`batches/${batch.id}/items/${valid.id}/upload`, { revision: 1, bytes: bytes.toString('base64') }, 2)).status, 403);
  assert.equal((await ok<MemoryBatch>(`batches/${batch.id}`, undefined, 3)).id, batch.id);
  const audits = await owner("SELECT user_id,after_data FROM public.audit_log WHERE action='memory.batch.created' AND entity_id=$1", [batch.id]);
  assert.equal(audits.length, 1); assert.equal(audits[0].user_id, batch.createdBy);
});

test('a resumed upload and import keep one original/material/job across lost replies and new request keys', async () => {
  let batch = await create([descriptor()]); const key = randomUUID();
  batch = await upload(batch, 0, bytes, 0, key); assert.equal(batch.items[0].status, 'ready'); const original = batch.items[0].original!;
  batch = await upload(batch, 0, bytes, 0, key); assert.equal(batch.items[0].original!.id, original.id);
  batch = await processItem(batch); assert.equal(batch.items[0].status, 'included'); const material = batch.items[0].materialId, job = batch.items[0].job!.id;
  batch = await processItem(batch); assert.equal(batch.items[0].materialId, material); assert.equal(batch.items[0].job!.id, job);
  const download = await api(`originals/${original.id}/file`); assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  assert.equal((await owner("SELECT count(*)::int AS n FROM public.reporter_memory_heads WHERE portal_id=$1 AND kind='material' AND doc->>'originalFileId'=$2", [PORTAL, original.id]))[0].n, 1);
  const duplicate = descriptor(bytes, 'A renamed copy.txt'); duplicate.input.title = 'A different display title';
  let again = await create([duplicate]); again = await upload(again); again = await processItem(again);
  assert.equal(again.items[0].status, 'existing'); assert.equal(again.items[0].materialId, material);
  assert.equal(again.items[0].file.name, 'A renamed copy.txt');
});

test('different historical metadata requires a current explicit choice and preserves the new origin occurrence', async () => {
  const item = descriptor(); item.input = { ...item.input, metadata: { ...metadata, edition: 'Another historical edition' } };
  let batch = await create([item]); batch = await upload(batch); batch = await processItem(batch);
  assert.equal(batch.items[0].status, 'pending_review'); assert.ok(batch.items[0].candidate); assert.equal(batch.items[0].materialId, null);
  const candidate = batch.items[0].candidate!, path = `batches/${batch.id}/items/${item.id}/process`;
  assert.equal((await api(path, { revision: 1, decision: { choice: 'reuse', expected: { ...candidate, revision: candidate.revision + 1 }, reason: 'Verified same document.' } })).status, 409);
  batch = await ok(path, { revision: 1, decision: { choice: 'reuse', expected: candidate, reason: 'Verified same document.' } });
  assert.equal(batch.items[0].status, 'existing'); assert.equal(batch.items[0].materialId, candidate.id);
  assert.equal(batch.items[0].input.metadata.edition, item.input.metadata.edition); assert.equal(batch.items[0].reason, 'Verified same document.');
});

test('storage failure leaves the original linked and an administrator resumes the exact same upload', async () => {
  const body = Buffer.from('Synthetic resumable document with a unique storage-failure example.');
  let batch = await create([descriptor(body)]); refuseStorage = true;
  try { assert.equal((await api(`batches/${batch.id}/items/${batch.items[0].id}/upload`, { revision: 1, bytes: body.toString('base64') })).status, 503); }
  finally { refuseStorage = false; }
  batch = await ok(`batches/${batch.id}`); assert.equal(batch.items[0].status, 'failed'); assert.ok(batch.items[0].original);
  const original = batch.items[0].original!.id;
  batch = await upload(batch, 0, body, 3); assert.equal(batch.items[0].original!.id, original); assert.equal(batch.items[0].status, 'ready');
  assert.notEqual(batch.items[0].original!.createdBy, batch.items[0].original!.storedBy);
  batch = await processItem(batch); assert.equal(batch.items[0].status, 'included');
  const individual = { ...batch.items[0].input, originalFileId: original };
  assert.equal((await api('materials/from-file', individual, 1)).status, 404);
  const reused = await api('materials/from-file', individual); assert.equal(reused.status, 200, await reused.clone().text());
  const result = await reused.json(); assert.equal(result.existing, true); assert.equal(result.material.id, batch.items[0].materialId);
  assert.notEqual(result.occurrence.batchId, batch.id);
});

test('explicit distinct editions retain their relation and unchanged reimport finds that exact edition', async () => {
  const item = descriptor(); item.input = { ...item.input, metadata: { ...metadata, edition: 'Explicitly distinct edition' }, primaryOrigin: 'synthetic:distinct' };
  let batch = await processItem(await upload(await create([item]))); assert.equal(batch.items[0].status, 'pending_review');
  const previous = batch.items[0].candidate!;
  batch = await ok(`batches/${batch.id}/items/${item.id}/process`, { revision: 1, decision: { choice: 'distinct', expected: previous, reason: 'Different historical edition explicitly retained.' } });
  assert.equal(batch.items[0].status, 'included'); assert.notEqual(batch.items[0].materialId, previous.id); assert.deepEqual(batch.items[0].candidate, previous);
  const reimport = { ...item, id: randomUUID() };
  const again = await processItem(await upload(await create([reimport])));
  assert.equal(again.items[0].status, 'existing'); assert.equal(again.items[0].materialId, batch.items[0].materialId);
});

test('concurrent identical documents yield one included material and one existing occurrence', async () => {
  const body = Buffer.from('A concurrent synthetic original with enough text to import independently.');
  let batch = await create([descriptor(body, 'one.txt'), descriptor(body, 'two.txt')]);
  await Promise.all([upload(batch, 0, body), upload(batch, 1, body)]); batch = await ok(`batches/${batch.id}`);
  await Promise.all([processItem(batch, 0), processItem(batch, 1)]); batch = await ok(`batches/${batch.id}`);
  assert.deepEqual(batch.items.map(item => item.status).sort(), ['existing', 'included']);
  assert.equal(batch.items[0].materialId, batch.items[1].materialId);
  assert.equal((await owner("SELECT count(*)::int AS n FROM public.reporter_memory_heads WHERE portal_id=$1 AND kind='material' AND id=$2", [PORTAL, batch.items[0].materialId]))[0].n, 1);
});

test('audit failure rolls the material, source, job and item result back together; replay remains recoverable', async () => {
  const body = Buffer.from('An atomic synthetic material that must not survive a failed reconciliation audit.');
  let batch = await upload(await create([descriptor(body)]), 0, body);
  await owner("CREATE FUNCTION public.synthetic_batch_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='memory.batch.item.reconciled' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$");
  await owner('CREATE TRIGGER synthetic_batch_audit_failure BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.synthetic_batch_audit_failure()');
  const key = randomUUID(), path = `batches/${batch.id}/items/${batch.items[0].id}/process`;
  try { assert.equal((await api(path, { revision: 1 }, 0, key)).status, 500); }
  finally { await owner('DROP TRIGGER synthetic_batch_audit_failure ON public.audit_log'); await owner('DROP FUNCTION public.synthetic_batch_audit_failure()'); }
  assert.equal((await owner("SELECT count(*)::int AS n FROM public.reporter_memory_heads WHERE portal_id=$1 AND kind='material' AND doc->>'originalFileId'=$2", [PORTAL, batch.items[0].original!.id]))[0].n, 0);
  batch = await ok(`batches/${batch.id}`); assert.equal(batch.items[0].status, 'failed'); assert.equal(batch.items[0].materialId, null);
  batch = await ok(path, { revision: 1 }, 0, key); assert.equal(batch.items[0].status, 'included');
});

test('refused bytes can be replaced with an audited revision while metadata edits keep stored original bytes', async () => {
  const bad = Buffer.from([255]), good = Buffer.from('A corrected synthetic original which was saved as valid UTF-8.');
  let batch = await create([descriptor(bad)]); const id = batch.items[0].id;
  assert.equal((await api(`batches/${batch.id}/items/${id}/upload`, { revision: 1, bytes: bad.toString('base64') })).status, 422);
  batch = await ok(`batches/${batch.id}`); assert.equal(batch.items[0].status, 'refused');
  const replacement = descriptor(good);
  batch = await ok(`batches/${batch.id}/items/${id}/revision`, { revision: 1, file: replacement.file, input: replacement.input, reason: 'The original was resaved as UTF-8.' });
  assert.equal(batch.items[0].revision, 2); assert.equal(batch.items[0].status, 'needs_file');
  assert.equal((await api(`batches/${batch.id}/items/${id}/upload`, { revision: 1, bytes: bad.toString('base64') })).status, 409);
  batch = await upload(batch, 0, good); const original = batch.items[0].original!.id;
  const key = randomUUID(), edit = { revision: 2, file: batch.items[0].file, input: { ...batch.items[0].input, title: 'Corrected title' }, reason: 'Editorial title corrected.' };
  batch = await ok(`batches/${batch.id}/items/${id}/revision`, edit, 0, key);
  assert.equal(batch.items[0].revision, 3); assert.equal(batch.items[0].original!.id, original);
  assert.equal((await ok<MemoryBatch>(`batches/${batch.id}/items/${id}/revision`, edit, 0, key)).items[0].revision, 3);
  batch = await processItem(batch); assert.equal(batch.items[0].status, 'included');
  const audits = await owner("SELECT count(*)::int AS n FROM public.audit_log WHERE action='memory.batch.item.updated' AND entity_id=$1", [id]); assert.equal(audits[0].n, 2);
});

test('batch owners resume administrator-created pending files without adopting another user’s unrelated file', async () => {
  const body = Buffer.from('Administrator started this upload, but the actual batch owner resumes it.');
  let batch = await create([descriptor(body)]); refuseStorage = true;
  try { assert.equal((await api(`batches/${batch.id}/items/${batch.items[0].id}/upload`, { revision: 1, bytes: body.toString('base64') }, 3)).status, 503); }
  finally { refuseStorage = false; }
  batch = await ok(`batches/${batch.id}`); assert.ok(batch.items[0].original); const original = batch.items[0].original!.id;
  assert.equal((await api(`originals/${original}`, undefined, 1)).status, 404);
  batch = await upload(batch, 0, body); assert.equal(batch.items[0].original!.id, original);
  assert.notEqual(batch.items[0].original!.createdBy, batch.items[0].original!.storedBy);
  batch = await processItem(batch); assert.equal(batch.items[0].status, 'included');
});

test('batch pagination keeps creation order across new batches, rejects foreign cursors and survives migration replay', async () => {
  const first = await ok<{ items: { id: string }[]; nextCursor: string; snapshot: string }>('batches?limit=2'); assert.ok(first.nextCursor);
  const added = await create([descriptor(Buffer.from('A new item created after the first page snapshot was read.'))]);
  const next = await ok<{ items: { id: string }[]; snapshot: string }>(`batches?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`);
  assert.equal(next.snapshot, first.snapshot); assert.ok(next.items.every(item => !first.items.some(previous => previous.id === item.id) && item.id !== added.id));
  assert.equal((await api(`batches?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`, undefined, 1)).status, 409);
  assert.equal((await api('batches?unknown=1')).status, 422);
  db.migrate(); const replayed = await ok<MemoryBatch>(`batches/${added.id}`); assert.equal(replayed.items[0].file.checksum, added.items[0].file.checksum);
});

test('a private counterpart disappears from pending reconciliation and never blocks an independent authorized import', async () => {
  const body = Buffer.from('A synthetic private counterpart used only to verify batch source ancestry.');
  let peer = await ok<MemoryBatch>('batches', { title: 'Peer batch', items: [descriptor(body)] }, 1);
  peer = await processItem(await upload(peer, 0, body, 1), 0, 1); const material = peer.items[0].materialId!;
  const detail = await ok<{ material: { source: { sourceId: string } } }>(`materials/${material}`, undefined, 1);
  const item = descriptor(body); item.input = { ...item.input, metadata: { ...metadata, edition: 'A second proposed occurrence' } };
  let batch = await processItem(await upload(await create([item]), 0, body)); assert.equal(batch.items[0].status, 'pending_review');
  const expected = batch.items[0].candidate!;
  const made = await handle(new Request(APP + '/api/reporter/w/reporter-ai/workspace', { method: 'POST', headers: { origin: APP, 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'createBlank', args: [{ title: 'Private batch ancestor', brief: { size: 'standard', sections: 2 } }], requestId: randomUUID() }) }),
    ['w', 'reporter-ai', 'workspace'], { identify: async () => identities[1], defer: () => {} });
  assert.equal(made.status, 200); const { value: production } = await made.json();
  await owner("UPDATE public.reporter_ed_productions SET source_ids=ARRAY[$2],doc=doc||jsonb_build_object('restrictedTo',jsonb_build_array($3::text)) WHERE portal_id=$4 AND production_id=$1", [production.productionId, detail.material.source.sourceId, peer.createdBy, PORTAL]);
  await owner("UPDATE public.reporter_memory_heads SET origin_production_id=$2 WHERE portal_id=$3 AND kind='material' AND id=$1", [material, production.productionId, PORTAL]);
  batch = await ok(`batches/${batch.id}`); assert.equal(batch.items[0].candidate, null);
  assert.equal((await api(`batches/${batch.id}/items/${item.id}/process`, { revision: 1, decision: { choice: 'reuse', expected, reason: 'This stale private comparison must be refused.' } })).status, 409);
  const independent = await processItem(await upload(await create([descriptor(body)]), 0, body));
  assert.equal(independent.items[0].status, 'included'); assert.notEqual(independent.items[0].materialId, material); assert.equal(independent.items[0].candidate, null);
});

test('batch identities, original bytes and reconciliation never cross workspace boundaries', async () => {
  await owner("INSERT INTO public.user_roles(user_id,role) SELECT id,'platform_admin' FROM core.users WHERE email=$1 ON CONFLICT DO NOTHING", [identities[3].email]);
  const create = await handle(new Request(APP + '/api/reporter/platform/workspaces', { method: 'POST', headers: { origin: APP, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Other batch client', slug: 'other-batches' }) }), ['platform', 'workspaces'], { identify: async () => identities[3] });
  assert.equal(create.status, 201, await create.clone().text()); const workspace = await create.json();
  const activated = await handle(new Request(`${APP}/api/reporter/platform/workspaces/${workspace.id}/update`, { method: 'POST', headers: { origin: APP, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Other batch client', status: 'active', revision: workspace.revision }) }), ['platform', 'workspaces', workspace.id, 'update'], { identify: async () => identities[3] });
  assert.equal(activated.status, 200);
  const item = descriptor(), slug = 'other-batches'; let other = await ok<MemoryBatch>('batches', { title: 'Other workspace batch', items: [item] }, 3, undefined, slug);
  other = await ok(`batches/${other.id}/items/${item.id}/upload`, { revision: 1, bytes: bytes.toString('base64') }, 3, undefined, slug);
  other = await ok(`batches/${other.id}/items/${item.id}/process`, { revision: 1 }, 3, undefined, slug);
  assert.equal(other.workspaceId, workspace.id); assert.equal(other.items[0].status, 'included'); assert.equal(other.items[0].candidate, null);
  assert.equal((await api(`batches/${other.id}`, undefined, 3)).status, 404);
  assert.equal((await api(`originals/${other.items[0].original!.id}/file`, undefined, 3)).status, 404);
});

test('batch UI imports, reconciles, corrects a refused document and resumes stored bytes after reload', { skip: !process.env.REPORTER_MEMORY_BATCH_UI_BASE }, async () => {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(APP).hostname));
  await exerciseMemoryBatchBrowser(APP, Number(process.env.REPORTER_MEMORY_BATCH_UI_WIDTH ?? 1440), request =>
    handle(request, new URL(request.url).pathname.split('/').slice(3), { identify: async () => identities[0], defer: () => {} }));
});
