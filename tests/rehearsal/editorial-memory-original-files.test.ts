import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg, { type Pool } from 'pg';
import type { MemoryOriginalFile } from '../../src/domain/editorial-memory-original-file.ts';
import { memoryEvidenceRef, type MemoryEvidence, type MemoryEvidenceView, type MemoryMaterial, type MemoryPage } from '../../src/domain/editorial-memory.ts';
import type { MemoryJob } from '../../src/ports/editorial-memory.ts';
import type { Source } from '../../src/domain/source.ts';
import { startRehearsalDatabase } from '../support/rehearsal-db.ts';
import { startFakeS3 } from '../support/fake-s3.ts';
import { startWorkerHost } from '../support/worker-host.ts';
import { exerciseMemoryLocationBrowser } from '../support/editorial-memory-location-browser.ts';

const APP = process.env.REPORTER_MEMORY_LOCATION_UI_BASE ?? 'http://127.0.0.1:3998', PORTAL = '10000000-0000-0000-0000-000000000101';
const identities = ['editor', 'peer', 'approver', 'admin'].map(role => ({ subject: `original-${role}`, email: `${role}@originals.test`, name: role, emailVerified: true }));
const bytes = Buffer.from('\ufeffinstituição;indicador;valor;unidade;período\r\nÓrgão sintético;Visitantes;1.234,56;pessoas;2025\r\n');
const upload = { name: 'Acervo — março.csv', bytes: bytes.toString('base64'), delimiter: ';' };
const metadata = { publishedOn: null, recordedOn: null, institution: null, company: null, event: null, edition: 'Edição sintética', topics: [], originalUrl: null };
const intake = (id: string) => ({ title: 'Synthetic original file', kind: 'archive', originalFileId: id, authorized: true, primaryOrigin: null, metadata });
let db: Awaited<ReturnType<typeof startRehearsalDatabase>>, storage: Awaited<ReturnType<typeof startFakeS3>>, host: Awaited<ReturnType<typeof startWorkerHost>>;
let handle: typeof import('../../src/server/http.ts').handleReporter, refuseStorage = false, otherWorkspace: string;
let original: MemoryOriginalFile, imported: { material: MemoryMaterial; job: MemoryJob };
let anchored: MemoryEvidence;
async function owner(sql: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: db.owner }); await client.connect();
  try { return (await client.query(sql, values)).rows; } finally { await client.end(); }
}
async function api(path: string, input?: unknown, actor = 0, key: string = randomUUID(), slug = 'reporter-ai') {
  return handle(new Request(`${APP}/api/reporter/w/${slug}/memory/${path}`, input === undefined ? {} : { method: 'POST',
    headers: { origin: APP, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(input) }),
  ['w', slug, 'memory', ...path.split('?')[0].split('/').filter(Boolean)], { identify: async () => identities[actor], defer: () => {} });
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
  } finally { await owner("UPDATE public.reporter_memory_heads SET origin_production_id=NULL WHERE portal_id=$2 AND kind='material' AND id=$1", [imported.material.id, PORTAL]); }
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
