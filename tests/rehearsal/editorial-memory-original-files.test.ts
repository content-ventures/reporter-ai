import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg, { type Pool } from 'pg';
import type { MemoryOriginalFile } from '../../src/domain/editorial-memory-original-file.ts';
import { memoryEvidenceRef, type MemoryEvidence, type MemoryEvidenceView, type MemoryMaterial, type MemoryPage } from '../../src/domain/editorial-memory.ts';
import type { MemoryJob } from '../../src/ports/editorial-memory.ts';
import type { MemoryBatch } from '../../src/ports/editorial-memory-batch.ts';
import type { Source } from '../../src/domain/source.ts';
import { startRehearsalDatabase } from '../support/rehearsal-db.ts';
import { startFakeS3 } from '../support/fake-s3.ts';
import { startWorkerHost } from '../support/worker-host.ts';
import { exerciseMemoryLocationBrowser } from '../support/editorial-memory-location-browser.ts';
import { exerciseMemorySingleFileBrowser } from '../support/editorial-memory-single-file-browser.ts';

const APP = process.env.REPORTER_MEMORY_SINGLE_UI_BASE ?? process.env.REPORTER_MEMORY_LOCATION_UI_BASE ?? 'http://127.0.0.1:3998', PORTAL = '10000000-0000-0000-0000-000000000101';
const identities = ['editor', 'peer', 'approver', 'admin'].map(role => ({ subject: `original-${role}`, email: `${role}@originals.test`, name: role, emailVerified: true }));
const bytes = Buffer.from('\ufeffinstituição;indicador;valor;unidade;período\r\nÓrgão sintético;Visitantes;1.234,56;pessoas;2025\r\n');
const upload = { name: 'Acervo — março.csv', bytes: bytes.toString('base64'), delimiter: ';' };
const metadata = { publishedOn: null, recordedOn: null, institution: null, company: null, event: null, edition: 'Edição sintética', topics: [], originalUrl: null };
const intake = (id: string) => ({ title: 'Synthetic original file', kind: 'archive', originalFileId: id, authorized: true, primaryOrigin: null, metadata });
let db: Awaited<ReturnType<typeof startRehearsalDatabase>>, storage: Awaited<ReturnType<typeof startFakeS3>>, host: Awaited<ReturnType<typeof startWorkerHost>>;
let handle: typeof import('../../src/server/http.ts').handleReporter, refuseStorage = false, otherWorkspace: string;
let original: MemoryOriginalFile, imported: { material: MemoryMaterial; job: MemoryJob };
let anchored: MemoryEvidence, wakeups = 0;
async function owner(sql: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: db.owner }); await client.connect();
  try { return (await client.query(sql, values)).rows; } finally { await client.end(); }
}
async function api(path: string, input?: unknown, actor = 0, key: string = randomUUID(), slug = 'reporter-ai') {
  return handle(new Request(`${APP}/api/reporter/w/${slug}/memory/${path}`, input === undefined ? {} : { method: 'POST',
    headers: { origin: APP, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(input) }),
  ['w', slug, 'memory', ...path.split('?')[0].split('/').filter(Boolean)], { identify: async () => identities[actor], defer: () => { wakeups++; } });
}
before(async () => {
  db = await startRehearsalDatabase(identities.map((identity, index) => ({ email: identity.email, role: ['editor', 'editor', 'approver', 'admin'][index] })));
  for (const identity of identities) await owner('UPDATE core.users SET auth_subject=$2,email_verified=true WHERE email=$1', [identity.email, identity.subject]);
  await owner("INSERT INTO public.user_roles(user_id,role) SELECT id,'platform_admin' FROM core.users WHERE email=$1", [identities[3].email]);
  Object.assign(process.env, { REPORTER_DEPLOYMENT_MODE: 'cloud', REPORTER_DATABASE_URL: db.runtime, REPORTER_WORKER_DATABASE_URL: db.worker,
    REPORTER_WORKER_PASSWORD: db.workerPassword, REPORTER_DEFAULT_PORTAL_ID: PORTAL, REPORTER_WORKSPACES_MODE: 'all', REPORTER_APP_ORIGINS: APP, REPORTER_MEMORY_MODE: 'on' });
  storage = await startFakeS3({ bucket: 'reporter-source-media', corsOrigins: [] });
  Object.assign(process.env, { AWS_ENDPOINT_URL_S3: storage.endpoint, AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'synthetic-access-key', AWS_SECRET_ACCESS_KEY: 'synthetic-secret-key' });
  const { createReporterWorker } = await import('../../functions/reporter-worker.ts'), worker = createReporterWorker();
  host = await startWorkerHost({ fetch: request => refuseStorage && new URL(request.url).pathname === '/memory-objects'
    ? Promise.resolve(Response.json({ error: 'SYNTHETIC_STORAGE_FAILURE' }, { status: 503 })) : worker.fetch(request) });
  process.env.REPORTER_WORKER_URL = host.url;
  ({ handleReporter: handle } = await import('../../src/server/http.ts'));
  const create = await handle(new Request(APP + '/api/reporter/platform/workspaces', { method: 'POST', headers: { origin: APP, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Other originals client', slug: 'other-originals' }) }), ['platform', 'workspaces'], { identify: async () => identities[3] });
  assert.equal(create.status, 201, await create.clone().text()); const made = await create.json(); otherWorkspace = made.id;
  const activated = await handle(new Request(`${APP}/api/reporter/platform/workspaces/${made.id}/update`, { method: 'POST', headers: { origin: APP, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Other originals client', status: 'active', revision: made.revision }) }), ['platform', 'workspaces', made.id, 'update'], { identify: async () => identities[3] });
  assert.equal(activated.status, 200, await activated.clone().text());
}, { timeout: 180000 });
after(async () => {
  try { await host?.stop(); await storage?.stop(); }
  finally {
    const pools = (globalThis as typeof globalThis & { reporterPools?: Partial<Record<string, Pool>> }).reporterPools ?? {};
    await Promise.all(Object.values(pools).map(pool => pool?.end())); db?.stop();
  }
});

test('upload stores exact private bytes and immutable actor-stamped metadata with idempotent retries', async () => {
  const key = randomUUID(), response = await api('originals', upload, 0, key); assert.equal(response.status, 200, await response.clone().text()); original = await response.json();
  assert.equal(original.status, 'stored'); assert.equal(original.createdBy, original.storedBy); assert.equal(original.workspaceId, PORTAL);
  assert.equal(original.name, upload.name); assert.equal(original.size, bytes.length); assert.equal(original.format, 'csv'); assert.equal(original.delimiter, ';');
  assert.deepEqual(await (await api('originals', upload, 0, key)).json(), original);
  const count = storage.requests.length;
  assert.equal((await api('originals', { ...upload, name: 'Changed.csv' }, 0, key)).status, 409);
  assert.equal(storage.requests.length, count, 'receipt conflict is refused before storage');
  const file = await api(`originals/${original.id}/file`); assert.equal(file.status, 200);
  assert.equal(file.headers.get('cache-control'), 'private, no-store'); assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
  assert.match(file.headers.get('content-disposition')!, /attachment; filename\*=UTF-8''Acervo/); assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
  const audits = await owner("SELECT action,user_id FROM public.audit_log WHERE entity_type='memory_original' AND entity_id=$1 ORDER BY created_at", [original.id]);
  assert.deepEqual(audits.map(row => row.action), ['memory.original.prepared', 'memory.original.stored']); assert.ok(audits.every(row => row.user_id === original.createdBy));
});

test('originals remain private before import and file/mutation access never crosses workspace or reviewer boundaries', async () => {
  const count = storage.requests.length;
  for (const actor of [1, 2]) for (const suffix of ['', '/file']) assert.equal((await api(`originals/${original.id}${suffix}`, undefined, actor)).status, 404);
  assert.equal((await api(`originals/${original.id}/file`, undefined, 3, randomUUID(), 'other-originals')).status, 404);
  assert.notEqual(otherWorkspace, PORTAL); assert.equal((await api('originals', upload, 2)).status, 403);
  assert.equal((await api('originals', { ...upload, createdBy: original.createdBy })).status, 422);
  assert.equal((await api('originals', upload, 0, 'short')).status, 422);
  assert.equal(storage.requests.length, count);
  assert.equal((await api(`originals/${original.id}?unknown=1`)).status, 422);
  assert.equal((await api(`originals/${randomUUID()}/file`)).status, 404);
});

test('file import creates complete original-bound source blocks and refuses client text tampering atomically', async () => {
  const key = randomUUID(), response = await api('materials/from-file', intake(original.id), 0, key);
  assert.equal(response.status, 200, await response.clone().text()); imported = await response.json();
  assert.deepEqual(await (await api('materials/from-file', intake(original.id), 0, key)).json(), imported);
  assert.equal(imported.material.originalFileId, original.id); assert.deepEqual(imported.material.metadata, metadata); assert.equal(imported.job.status, 'queued');
  const detail = await (await api(`materials/${imported.material.id}`)).json() as { source: Source };
  assert.equal(detail.source.versions[0].content.segments[0].text, bytes.toString('utf8')); assert.deepEqual(detail.source.speakers, []);
  for (const actor of [1, 2]) assert.deepEqual(Buffer.from(await (await api(`originals/${original.id}/file`, undefined, actor)).arrayBuffer()), bytes);
  assert.equal((await api('materials/from-file', intake(original.id), 2)).status, 403);
  const before = await owner('SELECT (SELECT count(*) FROM public.reporter_ed_sources) AS sources,(SELECT count(*) FROM public.reporter_memory_heads) AS heads');
  assert.equal((await api('materials/from-file', { ...intake(original.id), text: 'Forged text must never reach this source.' })).status, 422);
  assert.equal((await api('materials', { ...intake(original.id), text: 'Forged text must never reach this source.' })).status, 422);
  assert.deepEqual(await owner('SELECT (SELECT count(*) FROM public.reporter_ed_sources) AS sources,(SELECT count(*) FROM public.reporter_memory_heads) AS heads'), before);
});

test('evidence locates exact authorized original lines and table columns without returning file contents', async () => {
  const excerpt = 'Órgão sintético;Visitantes;1.234,56;pessoas;2025';
  const { runMemoryJob } = await import('../../src/server/editorial-memory-worker.ts');
  assert.equal(await runMemoryJob('original-location-test', new AbortController().signal, Date.now() + 1000000, async claim => ({
    value: { overflow: false, evidence: [{ kind: 'citation', excerpt, from: null, kinds: ['fact'] }] }, model: claim.job.model!, provider: 'synthetic',
    provider_request_id: null, usage_unit: 'tokens', input_units: 0, output_units: 0 })), true);
  const page = await (await api(`?materialId=${encodeURIComponent(imported.material.id)}`)).json() as MemoryPage<MemoryEvidenceView>;
  assert.equal(page.items.length, 1); anchored = page.items[0].evidence; const proof = memoryEvidenceRef(anchored);
  const path = `${anchored.id}/original-location?revision=${proof.revision}&hash=${proof.hash}`;
  for (const actor of [0, 1, 2]) {
    const response = await api(path, undefined, actor); assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get('cache-control'), 'private, no-store'); const location = await response.json();
    assert.deepEqual([location.firstLine, location.lastLine], [2, 2]); assert.deepEqual(location.records, [{ record: 2, columns: [1, 2, 3, 4, 5] }]);
    assert.equal(location.fileName, upload.name); assert.equal(location.originalFileId, original.id); assert.equal(JSON.stringify(location).includes(excerpt), false);
  }
  const before = storage.requests.length;
  assert.equal((await api(`${anchored.id}/original-location?revision=0&hash=0000000000000000`)).status, 409);
  assert.equal((await api(`${path}&extra=1`)).status, 422);
  assert.equal((await api(`${path}&hash=${proof.hash}`)).status, 422);
  assert.equal(storage.requests.length, before, 'invalid proofs must be refused before the private object read');
});

test('original evidence location is accessible and reset on close in the browser', { skip: !process.env.REPORTER_MEMORY_LOCATION_UI_BASE }, async () => {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(APP).hostname));
  await exerciseMemoryLocationBrowser(APP, Number(process.env.REPORTER_MEMORY_LOCATION_UI_WIDTH ?? 1440), anchored.anchor.excerpt, request =>
    handle(request, new URL(request.url).pathname.split('/').slice(3), { identify: async () => identities[0], defer: () => {} }));
});

test('individual file conflict is reviewed and retained in the browser', { skip: !process.env.REPORTER_MEMORY_SINGLE_UI_BASE }, async () => {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(APP).hostname));
  await exerciseMemorySingleFileBrowser(APP, Number(process.env.REPORTER_MEMORY_SINGLE_UI_WIDTH ?? 1440), bytes, imported.material.id, request =>
    handle(request, new URL(request.url).pathname.split('/').slice(3), { identify: async () => identities[0], defer: () => {} }),
  process.env.REPORTER_MEMORY_SINGLE_STALE_UI === '1' ? async () => {
    const response = await api(`materials/${imported.material.id}/revision`, { baseRevision: imported.material.revision, source: imported.material.source,
      text: 'Uma revisão sintética diferente da fonte exige nova comparação editorial.', reason: 'Alteração concorrente para o teste.' });
    assert.equal(response.status, 200, await response.clone().text());
  } : undefined);
});

test('individual imports reuse exact files, preserve occurrences and require review for different context', async () => {
  const copyResponse = await api('originals', { ...upload, name: 'Cópia renomeada.csv' }); assert.equal(copyResponse.status, 200);
  const copy = await copyResponse.json() as MemoryOriginalFile;
  const same = { ...intake(copy.id), title: 'Another display title' }, key = randomUUID();
  const response = await api('materials/from-file', same, 0, key); assert.equal(response.status, 200, await response.clone().text());
  const found = await response.json(); assert.equal(found.material.id, imported.material.id); assert.equal(found.existing, true);
  assert.deepEqual(await (await api('materials/from-file', same, 0, key)).json(), found);
  const existingBatch = await (await api(`batches/${found.occurrence.batchId}`)).json() as MemoryBatch;
  assert.equal(existingBatch.items[0].file.name, 'Cópia renomeada.csv'); assert.equal(existingBatch.items[0].materialId, imported.material.id);
  const generic = await api('materials', { ...same, text: bytes.toString('utf8') }); assert.equal(generic.status, 200);
  assert.equal((await generic.json()).material.id, imported.material.id);
  const unspecified = await api('materials/from-file', { ...same, metadata: { ...metadata, publication: null, documentAuthor: null, documentSection: null } });
  assert.equal(unspecified.status, 200, await unspecified.clone().text());
  assert.equal((await unspecified.json()).material.id, imported.material.id);
  const attributed = await api('materials/from-file', { ...same, metadata: { ...metadata, documentAuthor: 'Autora Sintética' } });
  assert.equal(attributed.status, 200, await attributed.clone().text());
  assert.ok((await attributed.json()).pending, 'a new document author requires an explicit reconciliation');
  const before = await owner("SELECT count(*)::int AS n FROM public.reporter_memory_heads WHERE kind='material' AND portal_id=$1", [PORTAL]);
  assert.equal((await api('materials', { ...same, text: 'Texto inventado que não pertence ao arquivo original.' })).status, 422);
  assert.deepEqual(await owner("SELECT count(*)::int AS n FROM public.reporter_memory_heads WHERE kind='material' AND portal_id=$1", [PORTAL]), before);

  const changed = { ...same, metadata: { ...metadata, edition: 'Outra edição sintética' } }, reviewKey = randomUUID();
  const pendingResponse = await api('materials/from-file', changed, 0, reviewKey); assert.equal(pendingResponse.status, 200);
  const pending = (await pendingResponse.json()).pending;
  assert.ok(pending?.batchId && pending?.itemId); assert.deepEqual((await (await api('materials/from-file', changed, 0, reviewKey)).json()).pending, pending);
  const batch = await (await api(`batches/${pending.batchId}`)).json() as MemoryBatch, item = batch.items[0];
  assert.equal(item.status, 'pending_review'); assert.equal(item.input.metadata.edition, 'Outra edição sintética'); assert.equal(item.candidate?.id, imported.material.id);
  const comparisonResponse = await api(`batches/${pending.batchId}/items/${pending.itemId}/candidate`);
  assert.equal(comparisonResponse.status, 200); assert.equal(comparisonResponse.headers.get('cache-control'), 'private, no-store');
  const comparison = await comparisonResponse.json(); assert.equal(comparison.material.id, imported.material.id); assert.equal(comparison.authorized, true);
  assert.equal(comparison.original.id, original.id); assert.equal(JSON.stringify(comparison).includes(bytes.toString('utf8')), false);
  assert.equal((await api(`batches/${pending.batchId}/items/${pending.itemId}/candidate`, undefined, 1)).status, 404);
  assert.equal((await api(`batches/${pending.batchId}/items/${pending.itemId}/candidate?extra=1`)).status, 422);
  const decision = { revision: item.revision, decision: { choice: 'reuse', expected: item.candidate, reason: 'Mesma publicação confirmada no teste sintético.' } };
  const decided = await api(`batches/${pending.batchId}/items/${pending.itemId}/process`, decision); assert.equal(decided.status, 200, await decided.clone().text());
  const resolved = await decided.json() as MemoryBatch; assert.equal(resolved.items[0].status, 'existing'); assert.equal(resolved.items[0].materialId, imported.material.id);
  assert.equal(resolved.items[0].input.metadata.edition, 'Outra edição sintética');
  const replay = await (await api('materials/from-file', changed, 0, reviewKey)).json();
  assert.equal(replay.material.id, imported.material.id); assert.deepEqual(replay.occurrence, pending);
});

test('concurrent individual imports of the same new original create one material and retain two occurrences', async () => {
  const text = Buffer.from('Documento sintético concorrente: 720 pessoas em 2025, sem valor factual real.');
  const uploadOne = { name: 'concorrente.txt', bytes: text.toString('base64') };
  const firstFile = await (await api('originals', uploadOne)).json(), secondFile = await (await api('originals', { ...uploadOne, name: 'segunda-cópia.txt' })).json();
  const input = (id: string) => ({ ...intake(id), kind: 'archive', title: 'Concorrente sintético' });
  const responses = await Promise.all([api('materials/from-file', input(firstFile.id)), api('materials/from-file', input(secondFile.id))]);
  for (const response of responses) assert.equal(response.status, 200, await response.clone().text());
  const results = await Promise.all(responses.map(response => response.json()));
  assert.equal(results[0].material.id, results[1].material.id); assert.deepEqual(results.map(result => result.existing).sort(), [false, true]);
  assert.notEqual(results[0].occurrence.batchId, results[1].occurrence.batchId);
});

test('an individual import rolls its occurrence and material back when reconciliation audit fails', async () => {
  const fileResponse = await api('originals', { name: 'auditoria.txt', bytes: Buffer.from('Documento sintético destinado à prova de recuperação atômica.').toString('base64') });
  assert.equal(fileResponse.status, 200); const file = await fileResponse.json();
  const before = await owner('SELECT count(*)::int AS n FROM public.reporter_memory_batches WHERE portal_id=$1', [PORTAL]);
  await owner("CREATE FUNCTION public.synthetic_file_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='memory.batch.item.reconciled' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$");
  await owner('CREATE TRIGGER synthetic_file_audit_failure BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.synthetic_file_audit_failure()');
  const key = randomUUID();
  try { assert.equal((await api('materials/from-file', intake(file.id), 0, key)).status, 500); }
  finally { await owner('DROP TRIGGER synthetic_file_audit_failure ON public.audit_log'); await owner('DROP FUNCTION public.synthetic_file_audit_failure()'); }
  assert.deepEqual(await owner('SELECT count(*)::int AS n FROM public.reporter_memory_batches WHERE portal_id=$1', [PORTAL]), before);
  assert.equal((await owner("SELECT count(*)::int AS n FROM public.reporter_memory_heads WHERE portal_id=$1 AND kind='material' AND doc->>'originalFileId'=$2", [PORTAL, file.id]))[0].n, 0);
  const retry = await api('materials/from-file', intake(file.id), 0, key); assert.equal(retry.status, 200, await retry.clone().text());
  assert.equal((await retry.json()).existing, false);
});

test('storage failures retain a pending original that retries without duplicate metadata or audit', async () => {
  const key = randomUUID(), value = { name: 'Pending.txt', bytes: Buffer.from('Synthetic pending original with sufficient literal content.').toString('base64') };
  refuseStorage = true;
  try {
    assert.equal((await api('originals', value, 0, key)).status, 503);
    const [pending] = await owner("SELECT id,status FROM public.reporter_memory_originals WHERE file_name='Pending.txt'"); assert.equal(pending.status, 'pending');
    assert.equal((await api(`originals/${pending.id}/file`)).status, 409);
    assert.equal((await api('materials/from-file', intake(pending.id))).status, 409);
  } finally { refuseStorage = false; }
  const completed = await api('originals', value, 0, key); assert.equal(completed.status, 200, await completed.clone().text()); const file = await completed.json() as MemoryOriginalFile;
  assert.equal(file.status, 'stored'); assert.deepEqual(await (await api('originals', value, 0, key)).json(), file);
  const [count] = await owner("SELECT count(*)::integer AS amount FROM public.reporter_memory_originals WHERE file_name='Pending.txt'"); assert.equal(count.amount, 1);
  const [audit] = await owner("SELECT count(*)::integer AS amount FROM public.audit_log WHERE entity_type='memory_original' AND entity_id=$1", [file.id]); assert.equal(audit.amount, 2);
});

test('concurrent identical uploads share one original; invalid documents never prepare metadata or objects', async () => {
  const key = randomUUID(), value = { name: 'Concurrent.txt', bytes: Buffer.from('A synthetic concurrent document with stable, exact bytes.').toString('base64') };
  const responses = await Promise.all(Array.from({ length: 6 }, () => api('originals', value, 0, key)));
  const ids = new Set<string>(); for (const response of responses) { assert.equal(response.status, 200, await response.clone().text()); ids.add((await response.json()).id); } assert.equal(ids.size, 1);
  const [row] = await owner('SELECT count(*)::integer AS amount FROM public.reporter_memory_originals'), count = storage.objects.size;
  for (const [invalid, status] of [[{ name: 'Unsupported.pdf', bytes: bytes.toString('base64') }, 415],
    [{ name: 'Invalid.txt', bytes: Buffer.from([0xc3, 0x28]).toString('base64') }, 422], [{ ...value, bytes: value.bytes + ' ' }, 422],
    [{ name: 'Too-large.txt', bytes: Buffer.alloc(1024 ** 2 + 1, 97).toString('base64') }, 413]] as const)
    assert.equal((await api('originals', invalid)).status, status);
  assert.deepEqual((await owner('SELECT count(*)::integer AS amount FROM public.reporter_memory_originals'))[0], row); assert.equal(storage.objects.size, count);
});

test('current private source ancestry is checked before original metadata or storage is read', async () => {
  const requestId = randomUUID(), made = await handle(new Request(APP + '/api/reporter/w/reporter-ai/workspace', { method: 'POST',
    headers: { origin: APP, 'content-type': 'application/json' }, body: JSON.stringify({ method: 'createBlank', args: [{ title: 'Private original ancestor', brief: { size: 'standard', sections: 2 } }], requestId }) }),
  ['w', 'reporter-ai', 'workspace'], { identify: async () => identities[0], defer: () => {} });
  assert.equal(made.status, 200, await made.clone().text()); const { value: production } = await made.json();
  await owner("UPDATE public.reporter_ed_productions SET source_ids=ARRAY[$2],doc=doc||jsonb_build_object('restrictedTo',jsonb_build_array($3::text)) WHERE portal_id=$4 AND production_id=$1",
    [production.productionId, imported.material.source.sourceId, original.createdBy, PORTAL]);
  await owner("UPDATE public.reporter_memory_heads SET origin_production_id=$2 WHERE portal_id=$3 AND kind='material' AND id=$1", [imported.material.id, production.productionId, PORTAL]);
  try {
    const count = storage.requests.length;
    for (const actor of [1, 2]) for (const suffix of ['', '/file']) assert.equal((await api(`originals/${original.id}${suffix}`, undefined, actor)).status, 404);
    const proof = memoryEvidenceRef(anchored), location = `${anchored.id}/original-location?revision=${proof.revision}&hash=${proof.hash}`;
    for (const actor of [1, 2]) assert.equal((await api(location, undefined, actor)).status, 404);
    assert.equal(storage.requests.length, count);
    assert.equal((await api(`originals/${original.id}/file`)).status, 200, 'the uploader still owns the retained original');
    const peerFile = await (await api('originals', { ...upload, name: 'Outro original.csv' }, 1)).json();
    const independent = await api('materials/from-file', intake(peerFile.id), 1); assert.equal(independent.status, 200, await independent.clone().text());
    const accepted = await independent.json(); assert.equal(accepted.existing, false); assert.notEqual(accepted.material.id, imported.material.id);
    const occurrence = await (await api(`batches/${accepted.occurrence.batchId}`, undefined, 1)).json() as MemoryBatch;
    assert.equal(occurrence.items[0].candidate, null, 'a private counterpart cannot be disclosed or block an independent import');
  } finally { await owner("UPDATE public.reporter_memory_heads SET origin_production_id=NULL WHERE portal_id=$2 AND kind='material' AND id=$1", [imported.material.id, PORTAL]); }
});

test('an explicitly distinct individual occurrence can be reimported without another material', async () => {
  const distinctInput = { ...intake(original.id), metadata: { ...metadata, edition: 'Edição distinta' } }, distinctKey = randomUUID();
  const distinctPending = (await (await api('materials/from-file', distinctInput, 0, distinctKey)).json()).pending;
  const distinctBatch = await (await api(`batches/${distinctPending.batchId}`)).json() as MemoryBatch, distinctItem = distinctBatch.items[0];
  const distinct = await api(`batches/${distinctPending.batchId}/items/${distinctPending.itemId}/process`, { revision: distinctItem.revision,
    decision: { choice: 'distinct', expected: distinctItem.candidate, reason: 'Edição distinta confirmada no teste sintético.' } });
  assert.equal(distinct.status, 200, await distinct.clone().text()); const distinctResult = await distinct.json() as MemoryBatch;
  assert.equal(distinctResult.items[0].status, 'included'); assert.notEqual(distinctResult.items[0].materialId, imported.material.id);
  const second = await (await api('materials/from-file', distinctInput)).json();
  assert.equal(second.existing, true); assert.equal(second.material.id, distinctResult.items[0].materialId);
});

test('an audit failure cannot finalize an original; the same upload action recovers the tracked pending record', async () => {
  await owner("CREATE FUNCTION public.fail_original_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='memory.original.stored' THEN RAISE EXCEPTION 'synthetic original audit failure'; END IF; RETURN NEW; END $$");
  await owner('CREATE TRIGGER fail_original_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.fail_original_audit()');
  const key = randomUUID(), value = { name: 'Audit-recovery.txt', bytes: Buffer.from('A synthetic document whose completion must include its audit event.').toString('base64') };
  let pendingId: string;
  try {
    assert.equal((await api('originals', value, 0, key)).status, 500);
    const [row] = await owner("SELECT id,status,stored_by,stored_at FROM public.reporter_memory_originals WHERE file_name='Audit-recovery.txt'");
    pendingId = row.id; assert.equal(row.status, 'pending'); assert.equal(row.stored_by, null); assert.equal(row.stored_at, null);
    assert.equal((await api(`originals/${pendingId}/file`)).status, 409);
  } finally { await owner('DROP TRIGGER fail_original_audit ON public.audit_log'); await owner('DROP FUNCTION public.fail_original_audit()'); }
  const response = await api('originals', value, 0, key); assert.equal(response.status, 200, await response.clone().text()); const completed = await response.json();
  assert.equal(completed.id, pendingId); assert.equal(completed.status, 'stored');
  const [audit] = await owner("SELECT count(*)::integer AS amount FROM public.audit_log WHERE entity_type='memory_original' AND entity_id=$1", [pendingId]); assert.equal(audit.amount, 2);
});

test('a source correction preserves the immutable uploaded file and refuses reassignment of its original identity', async () => {
  const response = await api(`materials/${imported.material.id}/revision`, { baseRevision: imported.material.revision, source: imported.material.source,
    text: 'A synthetic corrected logical source retains the exact earlier uploaded file in its history.', reason: 'Synthetic correction contract.' });
  assert.equal(response.status, 200, await response.clone().text()); const revised = await response.json();
  assert.equal(revised.material.originalFileId, original.id); assert.equal(revised.material.source.sourceVersion, 2);
  const proof = memoryEvidenceRef(anchored);
  assert.equal((await api(`${anchored.id}/original-location?revision=${proof.revision}&hash=${proof.hash}`)).status, 409);
  const refreshed = await (await api(anchored.id)).json(), current = memoryEvidenceRef(refreshed.evidence);
  assert.notDeepEqual(current, proof);
  const location = await api(`${anchored.id}/original-location?revision=${current.revision}&hash=${current.hash}`);
  assert.equal(location.status, 200, await location.clone().text()); assert.equal((await location.json()).firstLine, 2);
  assert.deepEqual(Buffer.from(await (await api(`originals/${original.id}/file`)).arrayBuffer()), bytes);
  await assert.rejects(owner("UPDATE public.reporter_memory_heads SET doc=jsonb_set(doc,'{originalFileId}',to_jsonb($2::text)) WHERE portal_id=$3 AND kind='material' AND id=$1",
    [imported.material.id, randomUUID(), PORTAL]), /INVALID_INPUT/);
});

test('metadata and exact original bindings survive official migration replay', async () => {
  const before = await (await api(`originals/${original.id}`)).json(); db.migrate();
  assert.deepEqual(await (await api(`originals/${original.id}`)).json(), before);
  assert.deepEqual(Buffer.from(await (await api(`originals/${original.id}/file`)).arrayBuffer()), bytes);
  assert.equal((await api('materials', { ...intake(original.id), text: 'A changed literal original must still be refused after replay.' })).status, 422);
});

test('market mappings save explicit column choices with source binding and reviewer access limits', async () => {
  const marketBytes = Buffer.from(bytes.toString('utf8').replace('Órgão sintético', 'Instituto de mercado sintético'));
  const fileResponse = await api('originals', { ...upload, name: 'Mercado sintético.csv', bytes: marketBytes.toString('base64') });
  assert.equal(fileResponse.status, 200, await fileResponse.clone().text()); const file = await fileResponse.json() as MemoryOriginalFile;
  const beforeWake = wakeups;
  const created = await api('materials/from-file', { ...intake(file.id), kind: 'market_data', title: 'Mercado sintético' });
  assert.equal(created.status, 200, await created.clone().text()); const { material } = await created.json() as { material: MemoryMaterial };
  assert.equal(wakeups, beforeWake + 1, 'committed file import wakes the worker');
  const root = `materials/${material.id}`;
  const choices = { institution: { record: 'row', column: 0 }, indicator: { record: 'row', column: 1 }, value: { record: 'row', column: 2 },
    unit: { record: 'row', column: 3 }, period: { record: 'row', column: 4 } };
  const preview = await api(`${root}/market-preview`, { mapping: choices }); assert.equal(preview.status, 200, await preview.clone().text());
  const shown = await preview.json(); assert.equal(shown.preview.rows[0].fields.value.value, '1.234,56');
  assert.equal(shown.preview.rows[0].fields.value.record, 2); assert.equal(shown.mapping, null);
  assert.equal((await api(`${root}/market-preview`, { mapping: choices }, 2)).status, 403);
  const input = { mapping: choices, revision: 0, materialRevision: material.revision, source: material.source, originalFileId: file.id, checksum: file.checksum }, key = randomUUID();
  assert.equal((await api(`${root}/market-mapping`, { ...input, checksum: '0'.repeat(64) })).status, 409);
  const saved = await api(`${root}/market-mapping`, input, 0, key); assert.equal(saved.status, 200, await saved.clone().text());
  const plan = await saved.json(); assert.equal(plan.revision, 1); assert.equal(plan.originalFileId, file.id);
  assert.deepEqual(plan.mapping, choices); assert.deepEqual(await (await api(`${root}/market-mapping`, input, 0, key)).json(), plan);
  assert.equal((await api(`${root}/market-mapping`, input)).status, 409);
  assert.equal((await api(`${root}/market-mapping`, { ...input, revision: 1 }, 2)).status, 403);
  const peer = await api(`${root}/market-preview`, { mapping: choices }, 1); assert.equal(peer.status, 200, await peer.clone().text());
  assert.equal((await peer.json()).mapping.revision, 1);
  const [audit] = await owner("SELECT user_id,after_data FROM public.audit_log WHERE action='memory.market.mapping' AND after_data->>'materialId'=$1", [material.id]);
  assert.equal(audit.user_id, plan.updatedBy); assert.deepEqual(audit.after_data, plan);
  const command = { revision: plan.revision, materialRevision: material.revision, source: material.source, originalFileId: file.id, checksum: file.checksum, start: 1 }, importKey = randomUUID();
  const response = await api(`${root}/market-import`, command, 0, importKey); assert.equal(response.status, 200, await response.clone().text());
  const report = await response.json(); assert.equal(report.rows.length, 1); assert.equal(report.rows[0].status, 'created');
  const evidenceResponse = await api(report.rows[0].id); assert.equal(evidenceResponse.status, 200, await evidenceResponse.clone().text());
  const evidence = await evidenceResponse.json(); assert.equal(evidence.evidence.value.raw, '1.234,56');
  assert.equal(evidence.evidence.market.fields.value.column, 3); assert.equal(evidence.eligibility.reason, 'review_required');
  const proof = memoryEvidenceRef(evidence.evidence);
  const reviewed = await api(`${report.rows[0].id}/review`, { evidence: proof, check: null, policyRevision: 1, previousSequence: 0,
    action: 'accept', reason: 'Conferido no arquivo original.', supports: [] });
  assert.equal(reviewed.status, 200, await reviewed.clone().text());
  const selection = await api('selections', { baseRevision: 0, productionId: null, evidence: [proof] }); assert.equal(selection.status, 200, await selection.clone().text());
  const chosen = await selection.json();
  const writing = await api(`selections/${chosen.id}/write`, { baseRevision: 1, title: 'Mercado para revisão', brief: { size: 'standard', sections: 3 } });
  assert.equal(writing.status, 200, await writing.clone().text()); const draft = await writing.json();
  const [source] = await owner('SELECT doc FROM public.reporter_ed_sources WHERE portal_id=$1 AND source_id=$2', [PORTAL, draft.sourceId]);
  assert.deepEqual(source.doc.memory[0].items[0].market, evidence.evidence.market);
  assert.deepEqual(await (await api(`${root}/market-import`, command, 0, importKey)).json(), report);
  const again = await api(`${root}/market-import`, command); assert.equal(again.status, 200, await again.clone().text());
  assert.equal((await again.json()).rows[0].status, 'existing');
  assert.equal((await api(`${root}/market-import`, command, 2)).status, 403);
  const importAudit = await owner("SELECT user_id,after_data FROM public.audit_log WHERE action='memory.market.import' AND after_data->>'materialId'=$1 ORDER BY created_at", [material.id]);
  assert.equal(importAudit.length, 2); assert.equal(importAudit[0].user_id, plan.updatedBy); assert.equal(importAudit[0].after_data.created, 1);
  const headerChoices = { ...choices, unit: { record: 'header', column: 3 } };
  const remap = await api(`${root}/market-mapping`, { ...input, revision: 1, mapping: headerChoices }); assert.equal(remap.status, 200, await remap.clone().text());
  const headerCommand = { ...command, revision: 2 };
  const headerImport = await api(`${root}/market-import`, headerCommand); assert.equal(headerImport.status, 200, await headerImport.clone().text());
  const headerReport = await headerImport.json(); assert.equal(headerReport.rows[0].status, 'created');
  const headerDetail = await (await api(headerReport.rows[0].id)).json(); assert.equal(headerDetail.evidence.unit, 'unidade');
  assert.equal(headerDetail.evidence.market.fields.unit.record, 1); assert.equal(headerDetail.eligibility.reason, 'review_required');
  const headerProof = memoryEvidenceRef(headerDetail.evidence);
  const headerReview = await api(`${headerReport.rows[0].id}/review`, { evidence: headerProof, check: null, policyRevision: 1, previousSequence: 0,
    action: 'accept', reason: 'Conferido o cabeçalho e a linha.', supports: [] }); assert.equal(headerReview.status, 200, await headerReview.clone().text());
  const headerSelection = await api('selections', { baseRevision: 0, productionId: null, evidence: [headerProof] }); assert.equal(headerSelection.status, 200, await headerSelection.clone().text());
  const headerChosen = await headerSelection.json();
  const headerWriting = await api(`selections/${headerChosen.id}/write`, { baseRevision: 1, title: 'Mercado com cabeçalho', brief: { size: 'standard', sections: 3 } });
  assert.equal(headerWriting.status, 200, await headerWriting.clone().text()); const headerDraft = await headerWriting.json();
  const [piece] = await owner("SELECT doc FROM public.reporter_ed_parts WHERE portal_id=$1 AND kind='piece' AND part_id=$2", [PORTAL, headerDraft.pieceId]);
  assert.ok(JSON.stringify(piece.doc.draft.body).includes('Unidade: unidade'));
  const valueChoices = { ...headerChoices, value: { record: 'header', column: 2 } };
  const valueRemap = await api(`${root}/market-mapping`, { ...input, revision: 2, mapping: valueChoices }); assert.equal(valueRemap.status, 200, await valueRemap.clone().text());
  const valueImport = await api(`${root}/market-import`, { ...command, revision: 3 }); assert.equal(valueImport.status, 200, await valueImport.clone().text());
  const valueReport = await valueImport.json(); assert.equal(valueReport.rows[0].status, 'created');
  const valueDetail = await (await api(valueReport.rows[0].id)).json(); assert.equal(valueDetail.evidence.value.raw, 'valor');
  assert.equal(valueDetail.evidence.market.fields.value.record, 1); assert.equal(valueDetail.eligibility.reason, 'review_required');
  const escapedBytes = Buffer.from('instituição;indicador;valor;unidade;período\n"Órgão ""A""";Vendas;240;pessoas;2025\n');
  const escapedFile = await (await api('originals', { name: 'Células.csv', bytes: escapedBytes.toString('base64'), delimiter: ';' })).json() as MemoryOriginalFile;
  const escapedImport = await api('materials/from-file', { ...intake(escapedFile.id), kind: 'market_data', title: 'Mercado com aspas' });
  assert.equal(escapedImport.status, 200, await escapedImport.clone().text()); const escapedMaterial = (await escapedImport.json()).material as MemoryMaterial;
  const escapedRoot = `materials/${escapedMaterial.id}`, escapedInput = { mapping: choices, revision: 0, materialRevision: escapedMaterial.revision,
    source: escapedMaterial.source, originalFileId: escapedFile.id, checksum: escapedFile.checksum };
  const escapedMapping = await api(`${escapedRoot}/market-mapping`, escapedInput); assert.equal(escapedMapping.status, 200, await escapedMapping.clone().text());
  const escapedRows = await api(`${escapedRoot}/market-import`, { ...escapedInput, mapping: undefined, revision: 1, start: 1 });
  assert.equal(escapedRows.status, 200, await escapedRows.clone().text()); const escapedReport = await escapedRows.json();
  assert.equal(escapedReport.rows[0].status, 'created');
  const escapedDetail = await (await api(escapedReport.rows[0].id)).json(); assert.equal(escapedDetail.evidence.issuingInstitution, 'Órgão "A"');
  assert.equal(escapedDetail.evidence.market.fields.institution.original, '"Órgão ""A"""');
  const escapedProof = memoryEvidenceRef(escapedDetail.evidence);
  const escapedReview = await api(`${escapedReport.rows[0].id}/review`, { evidence: escapedProof, check: null, policyRevision: 1, previousSequence: 0,
    action: 'accept', reason: 'Conferida a célula original.', supports: [] }); assert.equal(escapedReview.status, 200, await escapedReview.clone().text());
  const escapedSelection = await api('selections', { baseRevision: 0, productionId: null, evidence: [escapedProof] });
  assert.equal(escapedSelection.status, 200, await escapedSelection.clone().text()); const escapedChosen = await escapedSelection.json();
  const escapedWriting = await api(`selections/${escapedChosen.id}/write`, { baseRevision: 1, title: 'Mercado com célula decodificada', brief: { size: 'standard', sections: 3 } });
  assert.equal(escapedWriting.status, 200, await escapedWriting.clone().text()); const escapedDraft = await escapedWriting.json();
  const [escapedPiece] = await owner("SELECT doc FROM public.reporter_ed_parts WHERE portal_id=$1 AND kind='piece' AND part_id=$2", [PORTAL, escapedDraft.pieceId]);
  const escapedText = escapedPiece.doc.draft.body.blocks[0].inlines[0].text;
  assert.ok(escapedText.includes('Instituição: Órgão "A"')); assert.ok(escapedText.includes('"Órgão ""A""";Vendas;240;pessoas;2025'));
});

test('staging memory acceptance exercises the actual import, review and writing without providers', async () => {
  const { acceptMemoryFlow } = await import('../../scripts/neon-memory-acceptance.mjs');
  const foreign = { subject: randomUUID(), email: `outside-${randomUUID()}@originals.test`, name: 'Other user', emailVerified: true };
  await owner('INSERT INTO core.users(id,name,email,auth_subject,email_verified) VALUES($1,$2,$3,$4,true)', [randomUUID(), foreign.name, foreign.email, foreign.subject]);
  const call = async (actor: typeof foreign, path: string, input?: unknown) => {
    const response = await handle(new Request(`${APP}/api/reporter/${path}`, { method: input === undefined ? 'GET' : 'POST',
      headers: { origin: APP, 'content-type': 'application/json', 'idempotency-key': randomUUID() }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) }),
    path.split('/'), { identify: async () => actor, defer: () => {} });
    const content = Buffer.from(await response.arrayBuffer());
    return { status: response.status, value: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(content.toString()) : content };
  };
  const ok = async (actor: typeof foreign, path: string, input?: unknown) => {
    const response = await call(actor, path, input); assert.equal(response.status, 200, JSON.stringify(response.value)); return response.value;
  };
  const [reviewer] = await owner('SELECT id FROM core.users WHERE email=$1', [identities[2].email]);
  const setup = { ok, call, owner: { query: async (sql: string, args: unknown[]) => ({ rows: await owner(sql, args) }) },
    editor: identities[0], reviewer: { ...identities[2], id: reviewer.id }, other: foreign, client: { id: PORTAL, slug: 'reporter-ai' },
    environment: { ...process.env, REPORTER_MEMORY_MODE: 'off' } };
  await acceptMemoryFlow(setup);
  await assert.rejects(acceptMemoryFlow({ ...setup, environment: { ...process.env, REPORTER_MEMORY_MODE: 'on' } }), /worker ceiling off/);
});
