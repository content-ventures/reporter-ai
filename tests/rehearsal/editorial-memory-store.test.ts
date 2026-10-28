import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg, { type Pool, type Client } from 'pg';
import { startRehearsalDatabase } from '../support/rehearsal-db.ts';
import { createTranscriptSource, toSourceVersionRef } from '../../src/domain/source.ts';
import { parseTranscript } from '../../src/domain/text/transcript-parse.ts';
import { memoryEvidenceRef } from '../../src/domain/editorial-memory.ts';
import type { MemoryCitation, MemoryMaterial, MemoryMetadata } from '../../src/domain/editorial-memory.ts';
import type { ReporterRequestContext } from '../../src/server/request-context.ts';

const PILOT = '10000000-0000-0000-0000-000000000101', APP = 'http://127.0.0.1:3992';
const identities = ['admin', 'editor', 'approver', 'creative_reviewer'].map(role => ({
  role, subject: `memory-${role}`, email: `${role}@memory.test`, name: role, emailVerified: true,
}));
let db: Awaited<ReturnType<typeof startRehearsalDatabase>>, contexts: ReporterRequestContext[], second: ReporterRequestContext;
let otherWriter: ReporterRequestContext;
let source: ReturnType<typeof createTranscriptSource>, material: MemoryMaterial, citation: MemoryCitation;
const metadata: MemoryMetadata = { publishedOn: null, recordedOn: null, company: null, institution: null, event: null, edition: null, topics: [], originalUrl: null };
type Row = { id: string; storage_revision: number; doc: Record<string, unknown>; seq: number; fingerprint: string | null };
type Change = { kind: string; id: string; expected: number | null; doc: unknown; fingerprint?: string; sourceId?: string;
  productionId?: string; parentKind?: string; parentId?: string };
async function owner(sql: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: db.owner }); await client.connect();
  try { return (await client.query(sql, values)).rows; } finally { await client.end(); }
}
async function session<T>(context: ReporterRequestContext, action: (client: Client) => Promise<T>, inspect = false): Promise<T> {
  const client = new pg.Client({ connectionString: db.runtime }); await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.module_key','reporter_ai',true),set_config('app.access_mode',$5,true),set_config('app.tenant_id',$1,true),set_config('app.portal_id',$2,true),set_config('app.user_id',$3,true),set_config('app.request_id',$4,true)",
      [context.tenant, context.portal, context.actor, randomUUID(), context.administrative ? 'platform_workspace' : 'user']);
    if (inspect) await client.query("SELECT set_config('app.member_view',$1,true)", [randomUUID()]);
    const result = await action(client); await client.query('COMMIT'); return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { await client.end(); }
}
async function put(client: Client, change: Change): Promise<Row> {
  return (await client.query('SELECT public.reporter_memory_put($1::jsonb) AS value', [JSON.stringify(change)])).rows[0].value;
}
const read = (context: ReporterRequestContext, kind: string, id: string, revision: number | null = null) =>
  session(context, async client => (await client.query('SELECT public.reporter_memory_get($1,$2,$3) AS value', [kind, id, revision])).rows[0].value as Row | null);
const denied = (error: unknown) => (error as { code: string }).code === '42501';
const conflict = (error: unknown) => (error as Error).message === 'MEMORY_CONFLICT';
function evidenceChange(evidence: MemoryCitation, expected: number | null = null): Change {
  return { kind: 'evidence', id: evidence.id, expected, doc: evidence, parentKind: 'material', parentId: material.id, fingerprint: memoryEvidenceRef(evidence).hash };
}
before(async () => {
  const other = { subject: 'memory-other-writer', email: 'other-writer@memory.test', name: 'Other writer', emailVerified: true };
  db = await startRehearsalDatabase([...identities.map(identity => ({ email: identity.email, role: identity.role })), { email: other.email, role: 'editor' }]);
  for (const identity of identities) await owner('UPDATE core.users SET auth_subject=$2,email_verified=true WHERE email=$1', [identity.email, identity.subject]);
  await owner('UPDATE core.users SET auth_subject=$2,email_verified=true WHERE email=$1', [other.email, other.subject]);
  const [{ id: admin }] = await owner('SELECT id FROM core.users WHERE email=$1', [identities[0].email]);
  await owner("INSERT INTO public.user_roles(user_id,role) VALUES($1,'platform_admin')", [admin]);
  Object.assign(process.env, { REPORTER_DEPLOYMENT_MODE: 'cloud', REPORTER_DATABASE_URL: db.runtime, REPORTER_WORKER_DATABASE_URL: db.worker,
    REPORTER_DEFAULT_PORTAL_ID: PILOT, REPORTER_WORKSPACES_MODE: 'all', REPORTER_APP_ORIGINS: APP });
  const { resolveReporterContext } = await import('../../src/server/database.ts');
  contexts = await Promise.all(identities.map(async identity => (await resolveReporterContext(identity, 'reporter-ai'))!));
  otherWriter = (await resolveReporterContext(other, 'reporter-ai'))!;
  const { handleReporter } = await import('../../src/server/http.ts');
  const created = await handleReporter(new Request(`${APP}/api/reporter/platform/workspaces`, { method: 'POST',
    headers: { origin: APP, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Memory second client', slug: 'memory-second' }) }),
  ['platform', 'workspaces'], { identify: async () => identities[0] });
  assert.equal(created.status, 201); await created.json();
  second = (await resolveReporterContext(identities[0], 'memory-second'))!;
  assert.ok(second);
  source = createTranscriptSource({ workspaceId: PILOT, title: 'Synthetic original', origin: 'interview', authorized: true,
    parsed: parseTranscript('Ana Exemplo: A unidade sintética treinou 240 pessoas em 2025.', { format: 'speaker-lines' }) },
  { actorId: contexts[1].actor, now: '2026-10-28T12:00:00Z', newId: () => 'source-shared' });
  for (const context of [contexts[1], second]) await owner('INSERT INTO public.reporter_ed_sources(portal_id,source_id,doc,seq) VALUES($1,$2,$3,1)',
    [context.portal, source.id, JSON.stringify({ ...source, workspaceId: context.portal })]);
  material = { id: 'material', workspaceId: PILOT, revision: 1, title: 'Synthetic material', kind: 'transcript', source: toSourceVersionRef(source),
    metadata, importedAt: '2026-10-28T12:00:00Z', importedBy: contexts[1].actor, primaryOrigin: 'synthetic-original', originalFileId: null };
  const segment = source.versions[0].content.segments[0];
  citation = { id: 'evidence', workspaceId: PILOT, materialId: material.id, revision: 0,
    anchor: { source: material.source, spans: [{ segmentId: segment.id, from: 0, to: segment.text.length }], excerpt: segment.text }, metadata,
    kinds: ['declared'], status: 'active', createdAt: material.importedAt, updatedAt: material.importedAt, supersedes: null,
    kind: 'citation', text: segment.text, personId: contexts[1].actor, authorConfirmed: true, legacyCitationId: 'preserved-legacy-id' };
  await session(contexts[1], async client => {
    await put(client, { kind: 'material', id: material.id, expected: null, doc: material, sourceId: source.id });
    await put(client, evidenceChange(citation));
  });
}, { timeout: 180000 });
after(async () => {
  const pools = (globalThis as typeof globalThis & { reporterPools?: Partial<Record<string, Pool>> }).reporterPools ?? {};
  await Promise.all(Object.values(pools).map(pool => pool?.end())); db?.stop();
});

test('fresh schema and replay preserve source IDs, exact legacy payload and physical history', async () => {
  assert.deepEqual((await read(contexts[1], 'evidence', citation.id))!.doc, citation);
  db.migrate(); db.migrate();
  assert.deepEqual((await read(contexts[1], 'evidence', citation.id, 0))!.doc, citation);
  const [{ count }] = await owner('SELECT count(*)::int AS count FROM public.reporter_memory_history WHERE kind=$1 AND id=$2', ['evidence', citation.id]);
  assert.equal(count, 1);
  await assert.rejects(session(contexts[1], client => client.query('SELECT * FROM public.reporter_memory_heads')), denied);
  await assert.rejects(session(contexts[1], client => client.query('DELETE FROM public.reporter_memory_history')), denied);
});

test('source, parent and record IDs remain isolated even when two clients use the same source ID', async () => {
  assert.equal(await read(second, 'evidence', citation.id), null);
  await session(second, client => put(client, { kind: 'material', id: material.id, expected: null, doc: { ...material, workspaceId: second.portal }, sourceId: source.id }));
  assert.equal((await read(second, 'material', material.id))!.doc.workspaceId, second.portal);
  await assert.rejects(session(second, client => put(client, evidenceChange({ ...citation, workspaceId: PILOT }))), error => (error as { code: string }).code === '22023');
  await assert.rejects(session(contexts[1], client => put(client, { kind: 'material', id: 'foreign-source', expected: null,
    doc: { ...material, id: 'foreign-source', source: { ...material.source, sourceId: 'only-second' } }, sourceId: 'only-second' })), denied);
});

test('private productions retain their current source visibility in reads and mutations', async () => {
  await owner('INSERT INTO public.reporter_ed_productions(portal_id,production_id,doc,source_ids,seq) VALUES($1,$2,$3,$4,1)',
    [PILOT, 'private-production', JSON.stringify({ id: 'private-production', ownerId: contexts[1].actor, restrictedTo: [] }), [source.id]]);
  await session(contexts[1], client => put(client, { kind: 'material', id: 'private-material', expected: null, doc: { ...material, id: 'private-material' }, sourceId: source.id, productionId: 'private-production' }));
  assert.equal(await read(contexts[2], 'material', 'private-material'), null);
  assert.ok(await read(contexts[0], 'material', 'private-material'));
  const privateSource = { ...source, id: 'private-only-source' };
  await owner('INSERT INTO public.reporter_ed_sources(portal_id,source_id,doc,seq) VALUES($1,$2,$3,1)', [PILOT, privateSource.id, JSON.stringify(privateSource)]);
  await owner('UPDATE public.reporter_ed_productions SET source_ids=array_append(source_ids,$3) WHERE portal_id=$1 AND production_id=$2', [PILOT, 'private-production', privateSource.id]);
  await assert.rejects(session(otherWriter, client => put(client, { kind: 'material', id: 'promoted-private-source', expected: null,
    doc: { ...material, id: 'promoted-private-source', source: toSourceVersionRef(privateSource) }, sourceId: privateSource.id })), denied);
  await assert.rejects(session(otherWriter, client => put(client, { kind: 'selection', id: 'private-selection', expected: null,
    doc: { id: 'private-selection', workspaceId: PILOT, productionId: 'private-production' } })), denied);
  await assert.rejects(session(contexts[2], client => put(client, { kind: 'material', id: 'private-material', expected: 0,
    doc: { ...material, id: 'private-material', revision: 2 }, sourceId: source.id, productionId: 'private-production' })), denied);
  await assert.rejects(session(contexts[0], client => put(client, evidenceChange({ ...citation, id: 'inspection-write' })), true), denied);
});

test('every real workspace role can review; database audit stamps the actual actor and append-only sequence', async () => {
  for (let index = 0; index < contexts.length; index++) {
    const context = contexts[index], id = randomUUID();
    const saved = await session(context, client => put(client, { kind: 'decision', id, expected: null, parentKind: 'evidence', parentId: citation.id,
      doc: { id, workspaceId: PILOT, sequence: index + 1, evidence: memoryEvidenceRef(citation), check: null, policyRevision: 1,
        action: 'accept', reason: 'Conferi o original sintético.', personId: 'forged-actor', at: '1900-01-01T00:00:00Z', supports: [] } }));
    assert.equal(saved.doc.personId, context.actor); assert.notEqual(saved.doc.at, '1900-01-01T00:00:00Z');
    const [audit] = await owner("SELECT user_id,after_data FROM public.audit_log WHERE after_data->>'id'=$1 AND action='memory.evidence.accept'", [id]);
    assert.equal(audit.user_id, context.actor); assert.deepEqual(audit.after_data, saved.doc);
    await assert.rejects(session(context, client => put(client, { kind: 'decision', id, expected: 0, parentKind: 'evidence', parentId: citation.id, doc: saved.doc })), conflict);
  }
});

test('stale, empty or conflicting decisions fail atomically without audit or history rows', async () => {
  const before = (await owner("SELECT count(*)::int AS n FROM public.audit_log WHERE action LIKE 'memory.evidence.%'"))[0].n;
  for (const changes of [{ evidence: { ...memoryEvidenceRef(citation), revision: 99 } }, { sequence: 1 }, { reason: ' ' }, { policyRevision: 99 }]) {
    const id = randomUUID();
    await assert.rejects(session(contexts[2], client => put(client, { kind: 'decision', id, expected: null, parentKind: 'evidence', parentId: citation.id,
      doc: { id, workspaceId: PILOT, sequence: 5, evidence: memoryEvidenceRef(citation), check: null, policyRevision: 1,
        action: 'accept', reason: 'Conferência.', supports: [], ...changes } })), conflict);
    assert.equal(await read(contexts[2], 'decision', id), null);
  }
  assert.equal((await owner("SELECT count(*)::int AS n FROM public.audit_log WHERE action LIKE 'memory.evidence.%'"))[0].n, before);
});

test('source changes invalidate cursor visibility and withdrawn rights cannot be overridden', async () => {
  const context = () => session(contexts[1], async client => (await client.query('SELECT public.reporter_memory_context() AS value')).rows[0].value);
  const previous = await context();
  await owner("UPDATE public.reporter_ed_sources SET doc=jsonb_set(doc,'{rights,authorized}','false') WHERE portal_id=$1 AND source_id=$2", [PILOT, source.id]);
  assert.notEqual((await context()).visibility, previous.visibility);
  const id = randomUUID();
  await assert.rejects(session(contexts[2], client => put(client, { kind: 'decision', id, expected: null, parentKind: 'evidence', parentId: citation.id,
    doc: { id, workspaceId: PILOT, sequence: 5, evidence: memoryEvidenceRef(citation), check: null, policyRevision: 1, action: 'accept', reason: 'Conferência.', supports: [] } })), conflict);
  await owner("UPDATE public.reporter_ed_sources SET doc=jsonb_set(doc,'{rights,authorized}','true') WHERE portal_id=$1 AND source_id=$2", [PILOT, source.id]);
});

test('concurrent edits have one winner and historical snapshot pages retain the previous evidence', async () => {
  const before = await session(contexts[1], async client => (await client.query('SELECT public.reporter_memory_context() AS value')).rows[0].value);
  const next = { ...citation, revision: 1, metadata: { ...metadata, recordedOn: '2025-01-01' } };
  const results = await Promise.allSettled([1, 2].map(() => session(contexts[1], client => put(client, evidenceChange(next, 0)))));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const failed = results.find(result => result.status === 'rejected') as PromiseRejectedResult; assert.ok(conflict(failed.reason));
  assert.deepEqual((await read(contexts[1], 'evidence', citation.id, 0))!.doc, citation);
  const page = await session(contexts[1], async client => (await client.query('SELECT public.reporter_memory_scan($1,$2,$3,$4) AS value', ['evidence', before.snapshot, null, 25])).rows[0].value as Row[]);
  assert.deepEqual(page.find(row => row.id === citation.id)!.doc, citation);
  const invented = { ...next, id: 'invented', text: 'Uma frase que não está no original.', anchor: { ...next.anchor, excerpt: 'Uma frase que não está no original.' } };
  await assert.rejects(session(contexts[1], client => put(client, evidenceChange(invented))), error => (error as { code: string }).code === '22023');
});

test('concurrent retries reuse one actor-scoped receipt and payload mismatches do not replay', async () => {
  const request = randomUUID(), hash = 'a'.repeat(64);
  const command = () => session(contexts[1], async client => {
    const previous = (await client.query('SELECT public.reporter_memory_receipt($1,$2,$3) AS value', ['test-import', request, hash])).rows[0].value;
    if (previous.replayed) return previous.result;
    const doc = { ...material, id: 'receipt-material' };
    const saved = await put(client, { kind: 'material', id: doc.id, expected: null, doc, sourceId: source.id });
    await client.query('SELECT public.reporter_memory_receipt($1,$2,$3,$4::jsonb)', ['test-import', request, hash, JSON.stringify(saved)]); return saved;
  });
  const [a, b] = await Promise.all([command(), command()]); assert.deepEqual(a, b);
  assert.equal((await owner("SELECT count(*)::int AS n FROM public.reporter_memory_history WHERE kind='material' AND id='receipt-material'"))[0].n, 1);
  await assert.rejects(session(contexts[1], client => client.query('SELECT public.reporter_memory_receipt($1,$2,$3)', ['test-import', request, 'b'.repeat(64)])), conflict);
  const separate = await session(contexts[0], async client => (await client.query('SELECT public.reporter_memory_receipt($1,$2,$3) AS value', ['test-import', request, hash])).rows[0].value);
  assert.equal(separate.replayed, false);
});
