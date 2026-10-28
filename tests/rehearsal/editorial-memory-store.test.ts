import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg, { type Pool, type Client } from 'pg';
import { startRehearsalDatabase } from '../support/rehearsal-db.ts';
import { createTranscriptSource, toSourceVersionRef } from '../../src/domain/source.ts';
import { parseTranscript } from '../../src/domain/text/transcript-parse.ts';
import { memoryEvidenceRef } from '../../src/domain/editorial-memory.ts';
import type { MemoryCitation, MemoryMaterial, MemoryMetadata, MemoryStatistic } from '../../src/domain/editorial-memory.ts';
import type { MemoryPage, MemoryEvidenceView } from '../../src/domain/editorial-memory.ts';
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

type QueryResult = { items: { evidence: MemoryStatistic; check: unknown; checkState: string; reviewRestricted: boolean; decision: unknown; uses: Record<string, number> }[]; total: number; snapshot: string; next: { key: string; id: string } | null };
async function query(context: ReporterRequestContext, filters: object, snapshot?: string, after: unknown = null): Promise<QueryResult> {
  return session(context, async client => {
    const state = (await client.query('SELECT public.reporter_memory_context() AS value')).rows[0].value;
    return (await client.query('SELECT public.reporter_memory_query($1::jsonb,$2::bigint,$3::jsonb,$4) AS value',
      [JSON.stringify(filters), snapshot ?? state.snapshot, after ? JSON.stringify(after) : null, state.visibility])).rows[0].value;
  });
}
function statistic(id: string, index: number): MemoryStatistic {
  return { id, workspaceId: PILOT, materialId: material.id, revision: 1, anchor: citation.anchor,
    metadata: { ...metadata, topics: ['formação'], company: 'Empresa Sintética', event: 'Feira Sintética', edition: '2025', recordedOn: '2025-06-01', publishedOn: '2026-01-01' },
    kinds: ['declared'], status: 'active', createdAt: `2026-10-28T12:00:0${index}Z`, updatedAt: citation.updatedAt, supersedes: null,
    kind: 'statistic', indicator: `Treinamento lote ${index}`, value: { raw: '240', decimal: '240', lower: null, upper: null, scale: null }, unit: 'pessoas',
    period: { label: '2025', from: '2025-01-01', to: '2025-12-31' }, geography: null, population: null, qualifier: null, issuingInstitution: null, declaringPersonId: null };
}
test('SQL query filters, date meanings and snapshot pages remain complete while new evidence arrives', async () => {
  await session(contexts[1], async client => {
    for (let index = 0; index < 3; index++) {
      const evidence = statistic(`stat-${index}`, index);
      await put(client, { kind: 'evidence', id: evidence.id, expected: null, doc: evidence, fingerprint: memoryEvidenceRef(evidence).hash, parentKind: 'material', parentId: material.id });
    }
    const checked = statistic('stat-1', 1);
    await put(client, { kind: 'check', id: checked.id, expected: null, parentKind: 'evidence', parentId: checked.id,
      doc: { id: checked.id, workspaceId: PILOT, revision: 1, evidence: memoryEvidenceRef(checked), policyRevision: 1,
        checkedAt: citation.createdAt, verdict: 'validated', confidence: 85, claims: [], supports: [], strength: null, provider: null, model: null } });
  });
  const filters = { kind: 'statistic', query: 'Treinamento', topics: ['formação'], company: 'Empresa Sintética', event: 'Feira Sintética', edition: '2025', limit: 1 };
  const first = await query(contexts[2], filters); assert.equal(first.total, 3); assert.equal(first.items.length, 1); assert.ok(first.next);
  const late = statistic('stat-late', 4);
  await session(contexts[1], client => put(client, { kind: 'evidence', id: late.id, expected: null, doc: late, fingerprint: memoryEvidenceRef(late).hash, parentKind: 'material', parentId: material.id }));
  const ids = first.items.map(item => item.evidence.id); let next: QueryResult['next'] = first.next;
  while (next) { const page = await query(contexts[2], filters, first.snapshot, next); assert.equal(page.total, 3); ids.push(...page.items.map(item => item.evidence.id)); next = page.next; }
  assert.equal(new Set(ids).size, 3); assert.ok(!ids.includes(late.id));
  assert.equal((await query(contexts[2], { kind: 'statistic', minConfidence: 85 })).total, 1);
  assert.equal((await query(contexts[2], { kind: 'statistic', dateField: 'observation', from: '2024-01-01', to: '2024-12-31' })).total, 0);
  assert.equal((await query(contexts[2], { kind: 'statistic', dateField: 'recorded', from: '2025-01-01', to: '2025-12-31' })).total, 4);
  assert.equal((await query(contexts[2], { kind: 'statistic', dateField: 'published', from: '2025-01-01', to: '2025-12-31' })).total, 0);
});

test('real authenticated HTTP queries use signed tenant/actor cursors and do not fabricate policy activation', async () => {
  const { handleReporter } = await import('../../src/server/http.ts');
  const api = async (suffix: string, identity: typeof identities[number] | null = identities[2], slug = 'reporter-ai') => {
    const url = `${APP}/api/reporter/w/${slug}/memory${suffix}`;
    return handleReporter(new Request(url), ['w', slug, 'memory', ...(suffix.startsWith('/policy') ? ['policy'] : [])], { identify: async () => identity });
  };
  assert.equal((await api('?kind=statistic')).status, 404, 'module ceiling starts disabled');
  process.env.REPORTER_MEMORY_MODE = 'on'; process.env.REPORTER_WORKER_PASSWORD = db.workerPassword;
  const response = await api('?kind=statistic&limit=1'); assert.equal(response.status, 200, await response.clone().text());
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  const first = await response.json() as MemoryPage<MemoryEvidenceView>; assert.equal(first.total, 4); assert.ok(first.nextCursor);
  assert.equal(first.items[0].eligibility.usable, false, 'unactivated D10 still requires a person');
  const next = await api(`?kind=statistic&limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`); assert.equal(next.status, 200);
  assert.notEqual((await next.json() as MemoryPage<MemoryEvidenceView>).items[0].evidence.id, first.items[0].evidence.id);
  assert.equal((await api(`?kind=statistic&limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`, identities[1])).status, 409, 'another actual actor cannot reuse the cursor');
  const other = await api('?kind=statistic', identities[0], 'memory-second'); assert.equal(other.status, 200); assert.equal((await other.json()).total, 0);
  assert.equal((await api('?actor=forged')).status, 422); assert.equal((await api('?kind=statistic', null)).status, 401);
  const policy = await api('/policy'); assert.equal(policy.status, 200); const data = await policy.json();
  assert.equal(data.mode, 'review_required'); assert.equal(data.activatedAt, null); assert.equal(data.activatedBy, null);
});

test('microsecond ordering survives cursor serialization even when lexical IDs suggest the opposite order', async () => {
  for (const [id, instant] of [['zzz-older', '2026-10-28T12:01:00.000001Z'], ['aaa-newer', '2026-10-28T12:01:00.000002Z']]) {
    const evidence = { ...statistic(id, 0), createdAt: instant, metadata: { ...metadata, company: 'Precision only' } };
    await session(contexts[1], client => put(client, { kind: 'evidence', id, expected: null, doc: evidence, fingerprint: memoryEvidenceRef(evidence).hash, parentKind: 'material', parentId: material.id }));
  }
  const filters = { kind: 'statistic', company: 'Precision only', limit: 1 };
  const newest = await query(contexts[2], filters); assert.equal(newest.items[0].evidence.id, 'aaa-newer'); assert.ok(newest.next);
  const older = await query(contexts[2], filters, newest.snapshot, newest.next); assert.equal(older.items[0].evidence.id, 'zzz-older');
  assert.equal((await query(contexts[2], { ...filters, sort: 'oldest' })).items[0].evidence.id, 'zzz-older');
});

test('checks and decisions with private secondary evidence are withheld from users without that production access', async () => {
  const privateCitation = { ...citation, id: 'private-evidence', materialId: 'private-material' };
  await session(contexts[1], client => put(client, { ...evidenceChange(privateCitation), parentId: 'private-material' }));
  const target = statistic('stat-0', 0);
  await session(contexts[1], client => put(client, { kind: 'check', id: target.id, expected: null, parentKind: 'evidence', parentId: target.id,
    doc: { id: target.id, workspaceId: PILOT, revision: 1, evidence: memoryEvidenceRef(target), policyRevision: 1,
      checkedAt: citation.createdAt, verdict: 'validated', confidence: 99,
      supports: [{ claim: 0, relation: 'confirms', evidence: { kind: 'internal', evidence: memoryEvidenceRef(privateCitation), primaryOrigin: material.primaryOrigin, excerpt: privateCitation.anchor.excerpt } }],
      claims: [], strength: { score: 5, reason: 'Private editorial annotation' }, provider: null, model: null } }));
  assert.equal(await read(contexts[2], 'check', target.id), null);
  assert.ok(await read(contexts[1], 'check', target.id));
  const publicView = await query(contexts[2], { kind: 'statistic' });
  assert.equal(publicView.items.find(item => item.evidence.id === target.id)!.check, null);
  assert.ok(!JSON.stringify(publicView).includes('Private editorial annotation'));
  assert.equal((await query(contexts[2], { kind: 'statistic', minConfidence: 99 })).total, 0);
  assert.equal((await query(contexts[1], { kind: 'statistic' })).items.find(item => item.evidence.id === target.id)!.checkState, 'current');
  assert.equal((await query(contexts[1], { kind: 'statistic', minConfidence: 99 })).total, 1);
});

test('the application command service rechecks resource access before a cached reply and refuses forged role projections', async () => {
  const { runWithReporterContext } = await import('../../src/server/request-context.ts');
  const { memoryCommand, memoryGet, memoryPut } = await import('../../src/server/editorial-memory-store.ts');
  const { FlowError } = await import('../../src/server/errors.ts');
  const request = randomUUID(), doc = { ...material, id: 'command-private-material' };
  const execute = () => runWithReporterContext(contexts[1], () => memoryCommand('material.test', doc, request, 'library.edit', async client => {
    if (!await memoryGet(client, 'material', 'private-material')) throw new FlowError('NOT_FOUND', 404);
  }, async client => (await memoryPut(client, { kind: 'material', id: doc.id, expected: null, doc, sourceId: source.id, productionId: 'private-production' })).doc));
  assert.deepEqual(await execute(), doc); assert.deepEqual(await execute(), doc);
  await owner("UPDATE public.reporter_ed_productions SET doc=jsonb_set(doc,'{ownerId}',to_jsonb($3::text)) WHERE portal_id=$1 AND production_id=$2",
    [PILOT, 'private-production', otherWriter.actor]);
  await assert.rejects(execute(), (error: unknown) => error instanceof FlowError && error.code === 'NOT_FOUND');
  await owner("UPDATE public.reporter_ed_productions SET doc=jsonb_set(doc,'{ownerId}',to_jsonb($3::text)) WHERE portal_id=$1 AND production_id=$2",
    [PILOT, 'private-production', contexts[1].actor]);
  await assert.rejects(runWithReporterContext({ ...contexts[2], roles: ['admin'] }, () => memoryCommand('forged.test', {}, randomUUID(), 'library.edit',
    async () => {}, async () => { throw new Error('must not execute'); })), (error: unknown) => error instanceof FlowError && error.code === 'FORBIDDEN');
  assert.equal((await owner("SELECT count(*)::int AS n FROM public.reporter_memory_history WHERE kind='material' AND id=$1", [doc.id]))[0].n, 1);
});

test('remaining selectors and use stages match their actual data without counting repeated article occurrences twice', async () => {
  const market = { ...material, id: 'market-material', kind: 'market_data' };
  const special = { ...statistic('special-filter', 5), materialId: market.id, declaringPersonId: contexts[1].actor, issuingInstitution: 'Instituto Fonte',
    metadata: { ...metadata, company: 'Special only', institution: 'Instituto Publicador', topics: ['especial', 'formação'] } };
  await owner("INSERT INTO public.reporter_ed_items(portal_id,kind,item_id,doc,seq) VALUES($1,'person',$2,$3,1) ON CONFLICT(portal_id,kind,item_id) DO UPDATE SET doc=excluded.doc",
    [PILOT, contexts[1].actor, JSON.stringify({ id: contexts[1].actor, name: 'Pessoa Sintética' })]);
  await owner('INSERT INTO public.reporter_ed_productions(portal_id,production_id,doc,source_ids,seq) VALUES($1,$2,$3,$4,1)',
    [PILOT, 'public-count-production', JSON.stringify({ id: 'public-count-production', ownerId: contexts[1].actor }), [source.id]]);
  await session(contexts[1], async client => {
    await put(client, { kind: 'material', id: market.id, expected: null, doc: market, sourceId: source.id });
    await put(client, { kind: 'evidence', id: special.id, expected: null, doc: special, fingerprint: memoryEvidenceRef(special).hash, parentKind: 'material', parentId: market.id });
    for (const [id, productionId] of [['use-a', 'public-count-production'], ['use-b', 'public-count-production'], ['use-private', 'private-production']])
      await put(client, { kind: 'use', id, expected: null, parentKind: 'evidence', parentId: special.id,
        doc: { id, workspaceId: PILOT, evidence: memoryEvidenceRef(special), stage: 'inserted', productionId, pieceId: 'synthetic-piece', blockId: 'synthetic-block', from: 0, to: 5,
          draftRevision: 1, articleHash: 'synthetic', at: citation.createdAt, personId: contexts[1].actor } });
    await put(client, { kind: 'use', id: 'selection-only', expected: null, parentKind: 'evidence', parentId: special.id,
      doc: { id: 'selection-only', workspaceId: PILOT, evidence: memoryEvidenceRef(special), stage: 'selected', productionId: null,
        selectionId: 'synthetic-selection', at: citation.createdAt, personId: contexts[1].actor } });
  });
  const base = { kind: 'statistic', materialId: market.id };
  for (const filters of [{ personId: contexts[1].actor }, { institution: 'Instituto Fonte' }, { institution: 'Instituto Publicador' },
    { materialKind: 'market_data' }, { query: 'Pessoa Sintética' }, { verdict: 'pending' }, { unused: false }, { unused: true, useStage: 'published' }])
    assert.equal((await query(contexts[2], { ...base, ...filters })).total, 1, JSON.stringify(filters));
  assert.equal((await query(contexts[2], { ...base, unused: true })).total, 0);
  assert.equal((await query(contexts[2], base)).items[0].uses.inserted, 1);
  assert.equal((await query(contexts[1], base)).items[0].uses.inserted, 2);
  assert.equal((await query(contexts[2], base)).items[0].uses.selected, 1);
  assert.equal((await query(contexts[2], base)).items[0].uses.published, 0);
});

test('a stale check does not supply current confidence while its historical snapshot remains reproducible', async () => {
  const target = statistic('stat-1', 1);
  const before = await query(contexts[2], { kind: 'statistic', minConfidence: 85 }); assert.equal(before.total, 1);
  const current = await read(contexts[1], 'evidence', target.id);
  const revised = { ...target, revision: 2, metadata: { ...target.metadata, topics: ['revised'] } };
  await session(contexts[1], client => put(client, { kind: 'evidence', id: target.id, expected: current!.storage_revision, doc: revised,
    fingerprint: memoryEvidenceRef(revised).hash, parentKind: 'material', parentId: material.id }));
  assert.equal((await query(contexts[2], { kind: 'statistic', minConfidence: 85 })).total, 0);
  assert.equal((await query(contexts[2], { kind: 'statistic', minConfidence: 85 }, before.snapshot)).total, 1);
  const shown = (await query(contexts[2], { kind: 'statistic' })).items.find(item => item.evidence.id === target.id)!;
  assert.equal(shown.check, null); assert.equal(shown.checkState, 'outdated');
});

test('hiding a later private rejection never restores an earlier acceptance', async () => {
  const target = { ...citation, id: 'decision-shadow', metadata: { ...metadata, company: 'Shadow only' } };
  const privateRef = memoryEvidenceRef({ ...citation, id: 'private-evidence', materialId: 'private-material' });
  await session(contexts[1], async client => {
    await put(client, evidenceChange(target));
    for (const [sequence, action] of [[1, 'accept'], [2, 'reject']] as const) {
      const id = randomUUID();
      await put(client, { kind: 'decision', id, expected: null, parentKind: 'evidence', parentId: target.id,
        doc: { id, workspaceId: PILOT, sequence, evidence: memoryEvidenceRef(target), check: null, policyRevision: 1, action,
          reason: sequence === 1 ? 'Initial public acceptance' : 'Private rejection rationale',
          supports: sequence === 1 ? [] : [{ kind: 'internal', evidence: privateRef, primaryOrigin: 'private', excerpt: 'Private rejection rationale' }] } });
    }
  });
  const page = await query(contexts[2], { kind: 'citation', company: 'Shadow only' });
  assert.equal(page.items[0].decision, null); assert.equal(page.items[0].reviewRestricted, true);
  const { handleReporter } = await import('../../src/server/http.ts');
  const response = await handleReporter(new Request(`${APP}/api/reporter/w/reporter-ai/memory?kind=citation&company=Shadow%20only`),
    ['w', 'reporter-ai', 'memory'], { identify: async () => identities[2] });
  assert.equal(response.status, 200); const data = await response.json() as MemoryPage<MemoryEvidenceView>;
  assert.equal(data.items[0].eligibility.usable, false); assert.equal(data.items[0].reviewRestricted, true);
  assert.ok(!JSON.stringify(data).includes('Private rejection rationale'));
});

test('changing a searched person invalidates the old cursor instead of mixing live names into snapshot pages', async () => {
  const { handleReporter } = await import('../../src/server/http.ts');
  const url = `${APP}/api/reporter/w/reporter-ai/memory?kind=statistic&limit=1`;
  const api = (cursor?: string) => handleReporter(new Request(url + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '')),
    ['w', 'reporter-ai', 'memory'], { identify: async () => identities[2] });
  const first = await api(); assert.equal(first.status, 200); const page = await first.json() as MemoryPage<MemoryEvidenceView>; assert.ok(page.nextCursor);
  await owner("UPDATE public.reporter_ed_items SET doc=jsonb_set(doc,'{name}',to_jsonb('Revised synthetic person'::text)) WHERE portal_id=$1 AND kind='person' AND item_id=$2", [PILOT, contexts[1].actor]);
  const invalid = await api(page.nextCursor!); assert.equal(invalid.status, 409); assert.equal((await invalid.json()).error, 'MEMORY_CURSOR_INVALID');
});

test('the local test-profile branch honors the stored member role instead of the broader request projection', async () => {
  const { runWithReporterContext } = await import('../../src/server/request-context.ts');
  const { memoryCommand } = await import('../../src/server/editorial-memory-store.ts');
  const { FlowError } = await import('../../src/server/errors.ts');
  await owner("INSERT INTO public.reporter_ed_items(portal_id,kind,item_id,doc,seq) VALUES($1,'member',$2,$3,1) ON CONFLICT(portal_id,kind,item_id) DO UPDATE SET doc=excluded.doc",
    [PILOT, contexts[1].actor, JSON.stringify({ workspaceId: PILOT, personId: contexts[1].actor, roles: ['approver'] })]);
  const previous = process.env.REPORTER_DEPLOYMENT_MODE;
  try {
    // The already-created disposable pool remains the only database; no local/client credentials are loaded.
    process.env.REPORTER_DEPLOYMENT_MODE = 'local';
    await assert.rejects(runWithReporterContext(contexts[1], () => memoryCommand('profile.test', {}, randomUUID(), 'library.edit',
      async () => {}, async () => { throw new Error('must not execute'); })), (error: unknown) => error instanceof FlowError && error.code === 'FORBIDDEN');
  } finally { process.env.REPORTER_DEPLOYMENT_MODE = previous; }
});
async function memoryApi(path: string, options: { input?: unknown; requestId?: string; identity?: typeof identities[number] | null; slug?: string; origin?: string } = {}) {
  const { handleReporter } = await import('../../src/server/http.ts');
  const slug = options.slug ?? 'reporter-ai', url = new URL(`${APP}/api/reporter/w/${slug}/memory/${path}`);
  const identity = options.identity === undefined ? identities[2] : options.identity;
  return handleReporter(new Request(url, options.input === undefined ? {} : { method: 'POST', headers: {
    origin: options.origin ?? APP, 'content-type': 'application/json', ...(options.requestId ? { 'idempotency-key': options.requestId } : {}),
  }, body: JSON.stringify(options.input) }), ['w', slug, 'memory', ...url.pathname.split('/').slice(6)], { identify: async () => identity });
}

test('detail exposes original context and bounded history with stable cursors over more than one default page', async () => {
  const target = { ...citation, id: 'detail-target', legacyCitationId: null };
  await session(contexts[1], client => put(client, evidenceChange(target)));
  for (let revision = 1; revision <= 30; revision++) {
    const revised = { ...target, revision, metadata: { ...metadata, edition: `Synthetic ${revision}` } };
    await session(contexts[1], client => put(client, evidenceChange(revised, revision - 1)));
  }
  const response = await memoryApi(target.id); assert.equal(response.status, 200, await response.clone().text());
  const detail = await response.json(); assert.equal(detail.evidence.revision, 30);
  assert.equal(detail.source.segments[0].text, target.text); assert.deepEqual(detail.source.ref, target.anchor.source);
  assert.equal(detail.revisions.total, 31); assert.equal(detail.revisions.items.length, 25); assert.ok(detail.revisions.nextCursor);
  assert.equal(detail.policy.activatedAt, null); assert.equal(detail.eligibility.usable, false);
  const rest = await memoryApi(`${target.id}/history/revisions?cursor=${encodeURIComponent(detail.revisions.nextCursor)}`);
  assert.equal(rest.status, 200); const tail = await rest.json(); assert.equal(tail.items.length, 6);
  assert.deepEqual([...detail.revisions.items, ...tail.items].map((item: { revision: number }) => item.revision), Array.from({ length: 31 }, (_, index) => 30 - index));
  const first = await (await memoryApi(`${target.id}/history/revisions?limit=7`)).json(); assert.ok(first.nextCursor);
  const newest = { ...target, revision: 31 }; await session(contexts[1], client => put(client, evidenceChange(newest, 30)));
  const seen = first.items.map((item: { revision: number }) => item.revision); let cursor = first.nextCursor;
  while (cursor) {
    const page = await (await memoryApi(`${target.id}/history/revisions?limit=7&cursor=${encodeURIComponent(cursor)}`)).json();
    assert.equal(page.total, 31); assert.equal(page.snapshot, first.snapshot); seen.push(...page.items.map((item: { revision: number }) => item.revision)); cursor = page.nextCursor;
  }
  assert.deepEqual(seen, Array.from({ length: 31 }, (_, index) => 30 - index));
  for (const [path, identity] of [[`${target.id}/history/decisions`, identities[2]], [`${citation.id}/history/revisions`, identities[2]], [`${target.id}/history/revisions`, identities[1]]] as const)
    assert.equal((await memoryApi(`${path}?limit=7&cursor=${encodeURIComponent(first.nextCursor)}`, { identity })).status, 409);
  assert.equal((await memoryApi(`${target.id}/history/revisions?limit=7&limit=8`)).status, 422);
  assert.equal((await memoryApi(target.id, { slug: 'memory-second', identity: identities[0] })).status, 404);
});

test('detail redacts private secondary history and keeps stale checks explicit', async () => {
  const hidden = await memoryApi('stat-0'); assert.equal(hidden.status, 200); const detail = await hidden.json();
  assert.equal(detail.checkState, 'restricted'); assert.equal(detail.check, null); assert.equal(detail.checks.total, 0);
  assert.ok(!JSON.stringify(detail).includes('Private editorial annotation'));
  const stale = await (await memoryApi('stat-1')).json(); assert.equal(stale.checkState, 'outdated'); assert.equal(stale.check, null); assert.equal(stale.checks.total, 1);
  const rejected = await (await memoryApi('decision-shadow')).json(); assert.equal(rejected.reviewRestricted, true); assert.equal(rejected.eligibility.usable, false);
  assert.ok(!JSON.stringify(rejected).includes('Private rejection rationale'));
  assert.equal((await memoryApi('private-evidence')).status, 404);
  assert.equal((await memoryApi('absent')).status, 404);
});

test('every actual role reviews through HTTP with one actor-stamped audit and receipt per action', async () => {
  const target = { ...citation, id: 'review-target', legacyCitationId: null };
  await session(contexts[1], client => put(client, evidenceChange(target)));
  for (let index = 0; index < identities.length; index++) {
    const input = { evidence: memoryEvidenceRef(target), check: null, policyRevision: 1, previousSequence: index,
      action: 'accept', reason: `Synthetic editorial decision ${index}`, supports: [] };
    const requestId = randomUUID(), options = { input, requestId, identity: identities[index] };
    const response = await memoryApi(`${target.id}/review`, options); assert.equal(response.status, 200, await response.clone().text());
    const decision = await response.json(); assert.equal(decision.personId, contexts[index].actor); assert.equal(decision.sequence, index + 1); assert.ok(Date.parse(decision.at));
    const replay = await memoryApi(`${target.id}/review`, options); assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), decision);
    assert.equal((await memoryApi(`${target.id}/review`, { ...options, input: { ...input, reason: 'Different request' } })).status, 409);
    const audits = await owner("SELECT user_id,after_data FROM public.audit_log WHERE entity_type='memory_decision' AND after_data->>'id'=$1", [decision.id]);
    assert.equal(audits.length, 1); assert.equal(audits[0].user_id, contexts[index].actor); assert.deepEqual(audits[0].after_data, decision);
  }
  const detail = await (await memoryApi(target.id)).json(); assert.equal(detail.eligibility.usable, true); assert.equal(detail.decisions.total, 4);
  const input = { evidence: memoryEvidenceRef(target), check: null, policyRevision: 1, previousSequence: 4, action: 'reject', reason: 'Concurrent review', supports: [] };
  const results = await Promise.all([0, 1].map(index => memoryApi(`${target.id}/review`, { input, requestId: randomUUID(), identity: identities[index] })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal((await (await memoryApi(target.id)).json()).eligibility.usable, false);
  assert.equal((await memoryApi(`${target.id}/review`, { input: { ...input, personId: contexts[0].actor }, requestId: randomUUID() })).status, 422);
  assert.equal((await memoryApi(`${target.id}/review`, { input, requestId: randomUUID(), identity: null })).status, 401);
  assert.equal((await memoryApi(`${target.id}/review`, { input, requestId: randomUUID(), origin: 'https://foreign.test' })).status, 403);
  assert.equal((await memoryApi(`${target.id}/review`, { input })).status, 422);
});

test('HTTP review refuses stale/private checks and forged internal supporting text without leaving decisions', async () => {
  const target = { ...citation, id: 'review-support-target', legacyCitationId: null };
  await session(contexts[1], client => put(client, evidenceChange(target)));
  const input = { evidence: memoryEvidenceRef(target), check: null, policyRevision: 1, previousSequence: 0, action: 'accept', reason: 'Conferência sintética', supports: [] as unknown[] };
  const privateRef = memoryEvidenceRef({ ...citation, id: 'private-evidence', materialId: 'private-material' });
  const api = (id: string, changes = {}) => memoryApi(`${id}/review`, { input: { ...input, ...changes }, requestId: randomUUID() });
  assert.equal((await api(target.id, { supports: [{ kind: 'internal', evidence: memoryEvidenceRef(target), primaryOrigin: material.primaryOrigin, excerpt: 'Invented supporting text' }] })).status, 422);
  assert.equal((await api(target.id, { supports: [{ kind: 'internal', evidence: privateRef, primaryOrigin: material.primaryOrigin, excerpt: citation.text }] })).status, 403);
  assert.equal((await api(target.id, { evidence: { ...input.evidence, revision: 99 } })).status, 409);
  assert.equal((await api('stat-1')).status, 409); assert.equal((await api('stat-0')).status, 403);
  assert.equal((await api('decision-shadow')).status, 403);
  const detail = await (await memoryApi(target.id)).json(); assert.equal(detail.decisions.total, 0);
  const valid = await api(target.id, { supports: [{ kind: 'internal', evidence: memoryEvidenceRef(target), primaryOrigin: material.primaryOrigin, excerpt: citation.text }] });
  assert.equal(valid.status, 200, await valid.clone().text());
  const unknown = { ...target, id: 'unknown-author-review', personId: null, authorConfirmed: false };
  await session(contexts[1], client => put(client, evidenceChange(unknown)));
  assert.equal((await api(unknown.id, { evidence: memoryEvidenceRef(unknown) })).status, 422);
  await owner("UPDATE public.reporter_ed_sources SET doc=jsonb_set(doc,'{rights,authorized}','false') WHERE portal_id=$1 AND source_id=$2", [PILOT, source.id]);
  assert.equal((await api(target.id, { previousSequence: 1 })).status, 422);
  await owner("UPDATE public.reporter_ed_sources SET doc=jsonb_set(doc,'{rights,authorized}','true') WHERE portal_id=$1 AND source_id=$2", [PILOT, source.id]);
});

test('metadata correction preserves original words, invalidates acceptance and appends one actual-actor audit per retry', async () => {
  const target = { ...citation, id: 'correction-target', legacyCitationId: null };
  await session(contexts[1], client => put(client, evidenceChange(target)));
  const accepted = await memoryApi(`${target.id}/review`, { requestId: randomUUID(), input: {
    evidence: memoryEvidenceRef(target), check: null, policyRevision: 1, previousSequence: 0, action: 'accept', reason: 'Initial synthetic acceptance', supports: [],
  } }); assert.equal(accepted.status, 200);
  const input = { expected: memoryEvidenceRef(target), reason: 'Correct the synthetic edition', changes: { kind: 'citation', metadata: { edition: '2025' } } };
  const options = { input, requestId: randomUUID(), identity: identities[1] };
  const response = await memoryApi(`${target.id}/correction`, options); assert.equal(response.status, 200, await response.clone().text());
  const corrected = await response.json(); assert.equal(corrected.evidence.revision, 1); assert.equal(corrected.eligibility.usable, false);
  assert.equal(corrected.evidence.text, target.text); assert.deepEqual(corrected.evidence.anchor, target.anchor);
  assert.equal(corrected.evidence.correction.personId, contexts[1].actor); assert.equal(corrected.evidence.correction.reason, input.reason);
  assert.ok(Date.parse(corrected.evidence.correction.at)); assert.notEqual(memoryEvidenceRef(corrected.evidence).hash, input.expected.hash);
  const replay = await memoryApi(`${target.id}/correction`, options); assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), corrected);
  const rows = await owner("SELECT user_id,before_data,after_data FROM public.audit_log WHERE action='memory.evidence.correct' AND after_data->>'id'=$1", [target.id]);
  assert.equal(rows.length, 1); assert.equal(rows[0].user_id, contexts[1].actor); assert.deepEqual(rows[0].before_data, target); assert.deepEqual(rows[0].after_data, corrected.evidence);
  const detail = await (await memoryApi(target.id)).json(); assert.equal(detail.revisions.total, 2); assert.deepEqual(detail.revisions.items[1], target);
  assert.equal((await memoryApi(`${target.id}/correction`, { ...options, requestId: randomUUID() })).status, 409);
  for (const identity of [identities[2], identities[3]]) assert.equal((await memoryApi(`${target.id}/correction`, { ...options, identity, requestId: randomUUID() })).status, 403);
  const reviewed = await memoryApi(`${target.id}/review`, { requestId: randomUUID(), input: {
    evidence: memoryEvidenceRef(corrected.evidence), check: null, policyRevision: 1, previousSequence: 1, action: 'accept', reason: 'Review corrected edition', supports: [],
  } }); assert.equal(reviewed.status, 200, await reviewed.clone().text());
  assert.equal((await (await memoryApi(target.id)).json()).eligibility.usable, true, 'database correction stamps preserve the semantic fingerprint used by the next review');
});

test('concurrent different corrections have one winner without lost updates or extra audit rows', async () => {
  const target = { ...citation, id: 'concurrent-correction', legacyCitationId: null };
  await session(contexts[1], client => put(client, evidenceChange(target)));
  const results = await Promise.all(['2024', '2025'].map(edition => memoryApi(`${target.id}/correction`, { identity: identities[1], requestId: randomUUID(), input: {
    expected: memoryEvidenceRef(target), reason: `Synthetic edition ${edition}`, changes: { kind: 'citation', metadata: { edition } },
  } })));
  assert.deepEqual(results.map(response => response.status).sort(), [200, 409]);
  const detail = await (await memoryApi(target.id)).json(); assert.equal(detail.evidence.revision, 1); assert.equal(detail.revisions.total, 2);
  assert.equal((await owner("SELECT count(*)::int AS n FROM public.audit_log WHERE action='memory.evidence.correct' AND after_data->>'id'=$1", [target.id]))[0].n, 1);
});

test('correction rejects fabricated numeric context, missing people, immutable fields and no-op edits', async () => {
  const target = { ...statistic('numeric-correction', 0), legacyCitationId: undefined };
  await session(contexts[1], client => put(client, { kind: 'evidence', id: target.id, expected: null, doc: target,
    fingerprint: memoryEvidenceRef(target).hash, parentKind: 'material', parentId: material.id }));
  const change = (changes: unknown, extra = {}) => memoryApi(`${target.id}/correction`, { identity: identities[1], requestId: randomUUID(), input: {
    expected: memoryEvidenceRef(target), reason: 'Synthetic numeric correction', changes, ...extra,
  } });
  for (const changes of [{ kind: 'statistic', qualifier: 'invented qualifier' }, { kind: 'statistic', unit: 'invented unit' },
    { kind: 'statistic', value: { ...target.value, raw: '999999' } }, { kind: 'statistic', declaringPersonId: 'missing-person' },
    { kind: 'statistic', indicator: target.indicator }, { kind: 'statistic', anchor: target.anchor, indicator: 'Different indicator' }, { kind: 'citation', authorConfirmed: false }])
    assert.equal((await change(changes)).status, 422, JSON.stringify(changes));
  assert.equal((await change({ kind: 'statistic', indicator: 'Different indicator' }, { personId: contexts[0].actor })).status, 422);
  const valid = await change({ kind: 'statistic', indicator: 'Training coverage', geography: 'Synthetic region' });
  assert.equal(valid.status, 200, await valid.clone().text()); assert.equal((await valid.json()).evidence.revision, target.revision + 1);
  const detail = await (await memoryApi(target.id)).json(); assert.equal(detail.revisions.total, 2);
});

let legacy: import('../../src/domain/citation-library.ts').Citation, legacyPrivate: typeof legacy, legacyCheck: import('../../src/domain/fact-check.ts').FactCheck;
async function seedLegacyCitation(id: string, text: string, productionId = 'legacy-production') {
  const { citationId } = await import('../../src/domain/citation-library.ts');
  const original = createTranscriptSource({ workspaceId: '00000000-0000-0000-0000-000000000101', title: `Synthetic legacy ${id}`, origin: 'podcast', authorized: true,
    parsed: { format: 'speaker-lines', speakers: ['Ana Exemplo'], segments: [{ id: `segment-${id}`, speaker: 'Ana Exemplo', text }], warnings: [] },
    speakerPeople: { 'Ana Exemplo': contexts[1].actor } }, { actorId: contexts[1].actor, now: '2020-01-01T12:00:00Z', newId: () => id });
  await owner('INSERT INTO public.reporter_ed_sources(portal_id,source_id,doc,seq) VALUES($1,$2,$3,1)', [PILOT, id, JSON.stringify(original)]);
  await owner('INSERT INTO public.reporter_ed_productions(portal_id,production_id,doc,source_ids,seq) VALUES($1,$2,$3,$4,1) ON CONFLICT(portal_id,production_id) DO UPDATE SET source_ids=reporter_ed_productions.source_ids||excluded.source_ids',
    [PILOT, productionId, JSON.stringify({ id: productionId, ownerId: contexts[1].actor, title: 'Synthetic legacy production' }), [id]]);
  const ref = { kind: 'source' as const, sourceId: id, sourceVersion: 1, locator: { type: 'segment' as const, segmentId: original.versions[0].content.segments[0].id } };
  const citation: typeof legacy = { id: citationId(ref, text), revision: 3, text, ref, sourceHash: original.versions[0].hash, productionId,
    createdAt: '2020-01-01T12:00:00Z', updatedAt: '2020-01-02T12:00:00Z', personId: contexts[1].actor, authorConfirmed: true,
    relevance: 'Preserve the original editorial relevance.', podcastName: 'Synthetic historical podcast', podcastUrl: 'https://synthetic.test/episode', recordedOn: '2019-12-31', location: 'Synthetic location', origin: 'outline' };
  await owner("INSERT INTO public.reporter_ed_items(portal_id,kind,item_id,production_id,doc,seq) VALUES($1,'citation',$2,$3,$4,1)", [PILOT, citation.id, productionId, JSON.stringify(citation)]);
  return citation;
}
async function backfillLegacy() {
  const reports: { id: string; state: string }[] = []; let after: string | null = null;
  do {
    const response = await memoryApi('reconcile', { identity: identities[1], requestId: randomUUID(), input: { after, limit: 1 } });
    assert.equal(response.status, 200, await response.clone().text()); const page = await response.json(); reports.push(...page.items); after = page.nextAfter;
  } while (after);
  return reports;
}

test('legacy backfill retains 1200-character words, IDs, revision zero/three, metadata, overrides and history without converting scores', async () => {
  const long = 'O mercado sintético mantém a série original para comparação editorial. '.repeat(24).slice(0, 1200);
  legacy = await seedLegacyCitation('legacy-source', long);
  legacyPrivate = await seedLegacyCitation('legacy-private-source', 'A fonte privada mantém uma declaração sintética para testar o isolamento.', 'private-production');
  const zero = { ...await seedLegacyCitation('legacy-zero-source', 'Uma declaração sintética mantém sua autoria e sua data desconhecidas.'), revision: 0, recordedOn: undefined, personId: undefined, authorConfirmed: false };
  await owner("UPDATE public.reporter_ed_items SET doc=$3 WHERE portal_id=$1 AND kind='citation' AND item_id=$2", [PILOT, zero.id, JSON.stringify(zero)]);
  legacyCheck = { id: legacy.id, checkedAt: '2021-01-01T12:00:00Z', model: 'synthetic-legacy', claims: [{ text: 'A synthetic historical claim', kind: 'declared', verdict: 'disputed', sources: [] }],
    strength: { score: 5, reason: 'Original editorial strength' }, overrides: [{ claim: 0, verdict: 'validated', reason: 'Original decision', personId: contexts[0].actor, at: '2021-01-02T12:00:00Z' }],
    history: [{ checkedAt: '2020-12-31T12:00:00Z', verdict: 'not_validated' }] };
  await owner("INSERT INTO public.reporter_ed_items(portal_id,kind,item_id,doc,seq) VALUES($1,'fact_check',$2,$3,1)", [PILOT, legacy.id, JSON.stringify(legacyCheck)]);
  const unsafe = { ...legacy, id: 'legacy-nonliteral', text: 'Palavras inventadas que não estão no material original.' };
  const missing = { ...legacy, id: 'legacy-missing-source', ref: { ...legacy.ref, sourceId: 'absent-source' } };
  for (const record of [unsafe, missing]) await owner("INSERT INTO public.reporter_ed_items(portal_id,kind,item_id,production_id,doc,seq) VALUES($1,'citation',$2,$3,$4,1)", [PILOT, record.id, record.productionId, JSON.stringify(record)]);
  const reports = await backfillLegacy();
  assert.equal(reports.find(item => item.id === legacy.id)?.state, 'imported'); assert.equal(reports.find(item => item.id === legacyPrivate.id)?.state, 'imported');
  assert.equal(reports.find(item => item.id === unsafe.id)?.state, 'nonliteral'); assert.equal(reports.find(item => item.id === missing.id)?.state, 'source_unavailable');
  const response = await memoryApi(legacy.id); assert.equal(response.status, 200); const detail = await response.json();
  assert.equal(detail.evidence.id, legacy.id); assert.equal(detail.evidence.legacyCitationId, legacy.id); assert.equal(detail.evidence.text.length, 1200);
  assert.equal(detail.evidence.revision, 3); assert.deepEqual(detail.evidence.legacy.citation, legacy); assert.deepEqual(detail.evidence.legacy.factCheck, legacyCheck);
  assert.equal(detail.evidence.legacy.importedBy, contexts[1].actor); assert.equal(detail.check, null); assert.equal(detail.eligibility.usable, false);
  assert.equal(detail.evidence.metadata.recordedOn, legacy.recordedOn); assert.equal(detail.evidence.metadata.publishedOn, null);
  const unknown = await (await memoryApi(zero.id)).json(); assert.equal(unknown.evidence.revision, 0); assert.equal(unknown.evidence.metadata.recordedOn, null);
  assert.equal(unknown.evidence.metadata.publishedOn, null); assert.equal(unknown.evidence.personId, null); assert.equal(unknown.eligibility.reason, 'authorship_pending');
  assert.equal((await memoryApi(legacyPrivate.id)).status, 404); assert.equal((await memoryApi(legacy.id, { identity: identities[0], slug: 'memory-second' })).status, 404);
  db.migrate(); db.migrate();
  const retried = await backfillLegacy(); assert.equal(retried.find(item => item.id === legacy.id)?.state, 'unchanged');
  assert.deepEqual((await owner("SELECT doc FROM public.reporter_ed_items WHERE portal_id=$1 AND kind='citation' AND item_id=$2", [PILOT, legacy.id]))[0].doc, legacy);
  assert.equal((await owner('SELECT doc FROM public.reporter_ed_sources WHERE portal_id=$1 AND source_id=$2', [PILOT, legacy.ref.sourceId]))[0].doc.workspaceId, '00000000-0000-0000-0000-000000000101');
  assert.equal((await (await memoryApi(legacy.id)).json()).revisions.total, 1);
  assert.equal((await memoryApi('reconcile', { requestId: randomUUID(), input: {} })).status, 403);
});

async function updateLegacyCitation(changes: Partial<typeof legacy>) {
  const { runWithReporterContext } = await import('../../src/server/request-context.ts');
  const { editorialTransaction } = await import('../../src/server/editorial.ts');
  return runWithReporterContext(contexts[1], () => editorialTransaction('runtime', async checkpoint => {
    const record = checkpoint.citations!.find(item => item.id === legacy.id)!;
    Object.assign(record, changes, { revision: record.revision + 1, updatedAt: new Date().toISOString() });
  }, true, 'reporter.edit', { productions: [], parts: [], sources: 'none', runs: 'none', pipelines: false, items: { citation: [legacy.id] } }));
}

test('old curation writes synchronize atomically and a legacy-only fact-check update cannot inflate bank confidence', async () => {
  await updateLegacyCitation({ recordedOn: '2020-02-02' });
  const detail = await (await memoryApi(legacy.id)).json(); assert.equal(detail.evidence.metadata.recordedOn, '2020-02-02');
  assert.equal(detail.evidence.legacy.citation.recordedOn, '2020-02-02'); assert.equal(detail.evidence.revision, 4);
  assert.equal(detail.check, null); assert.equal(detail.eligibility.usable, false);
  const before = detail.evidence;
  await owner("CREATE FUNCTION public.fail_memory_legacy_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='memory.legacy.reconcile' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$");
  await owner('CREATE TRIGGER fail_memory_legacy_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.fail_memory_legacy_audit()');
  try { await assert.rejects(updateLegacyCitation({ recordedOn: '2020-03-03' }), /synthetic audit failure/); }
  finally { await owner('DROP TRIGGER fail_memory_legacy_audit ON public.audit_log'); await owner('DROP FUNCTION public.fail_memory_legacy_audit()'); }
  assert.equal((await owner("SELECT doc FROM public.reporter_ed_items WHERE portal_id=$1 AND kind='citation' AND item_id=$2", [PILOT, legacy.id]))[0].doc.recordedOn, '2020-02-02');
  assert.deepEqual((await (await memoryApi(legacy.id)).json()).evidence, before);
});

test('bank corrections survive legacy updates, conflict resolution guards both snapshots and requires a fresh acceptance', async () => {
  const initial = await (await memoryApi(legacy.id)).json();
  const corrected = await memoryApi(`${legacy.id}/correction`, { identity: identities[1], requestId: randomUUID(), input: {
    expected: memoryEvidenceRef(initial.evidence), reason: 'Correct historical speech date', changes: { kind: 'citation', metadata: { recordedOn: '2019-10-10' } },
  } }); assert.equal(corrected.status, 200);
  await updateLegacyCitation({ recordedOn: '2020-04-04' });
  const pending = await (await memoryApi(legacy.id)).json(); assert.equal(pending.evidence.metadata.recordedOn, '2019-10-10');
  assert.equal(pending.evidence.legacy.state, 'conflict'); assert.equal(pending.evidence.legacy.citation.recordedOn, '2020-04-04');
  const review = await memoryApi(`${legacy.id}/review`, { requestId: randomUUID(), input: { evidence: memoryEvidenceRef(pending.evidence), check: null,
    policyRevision: 1, previousSequence: 0, action: 'accept', reason: 'Unresolved legacy change', supports: [] } }); assert.equal(review.status, 409);
  const input = { expected: memoryEvidenceRef(pending.evidence), legacyHash: pending.evidence.legacy.hash, choice: 'keep_bank', reason: 'Keep the corrected source date' };
  await updateLegacyCitation({ recordedOn: '2020-05-05' });
  const stale = await memoryApi(`${legacy.id}/legacy`, { identity: identities[1], requestId: randomUUID(), input }); assert.equal(stale.status, 409);
  const latest = await (await memoryApi(legacy.id)).json();
  const resolved = await memoryApi(`${legacy.id}/legacy`, { identity: identities[1], requestId: randomUUID(), input: { ...input, legacyHash: latest.evidence.legacy.hash } });
  assert.equal(resolved.status, 200, await resolved.clone().text()); const kept = await resolved.json();
  assert.equal(kept.evidence.metadata.recordedOn, '2019-10-10'); assert.equal(kept.evidence.legacy.state, 'synchronized'); assert.equal(kept.eligibility.usable, false);
  const revision = kept.evidence.revision;
  await updateLegacyCitation({ relevance: 'New legacy curation text without changing evidence metadata.' });
  const refreshed = await (await memoryApi(legacy.id)).json(); assert.equal(refreshed.evidence.metadata.recordedOn, '2019-10-10'); assert.equal(refreshed.evidence.revision, revision);
  await updateLegacyCitation({ recordedOn: '2020-06-06' });
  const newConflict = await (await memoryApi(legacy.id)).json(); assert.equal(newConflict.evidence.legacy.state, 'conflict');
  const applied = await memoryApi(`${legacy.id}/legacy`, { identity: identities[1], requestId: randomUUID(), input: {
    expected: memoryEvidenceRef(newConflict.evidence), legacyHash: newConflict.evidence.legacy.hash, choice: 'apply_legacy', reason: 'Use newly confirmed historical date',
  } }); assert.equal(applied.status, 200, await applied.clone().text()); const current = await applied.json(); assert.equal(current.evidence.metadata.recordedOn, '2020-06-06');
  const acceptance = await memoryApi(`${legacy.id}/review`, { requestId: randomUUID(), input: { evidence: memoryEvidenceRef(current.evidence), check: null,
    policyRevision: 1, previousSequence: 0, action: 'accept', reason: 'Reviewed original and the resolved date', supports: [] } }); assert.equal(acceptance.status, 200, await acceptance.clone().text());
  assert.equal((await (await memoryApi(legacy.id)).json()).eligibility.usable, true, 'old pilot alias is projected through actual row ownership');
});

test('fact-check and source commits refresh legacy payloads/material metadata while preserving current confidence boundaries', async () => {
  const { runWithReporterContext } = await import('../../src/server/request-context.ts');
  const { editorialTransaction } = await import('../../src/server/editorial.ts');
  const before = await (await memoryApi(legacy.id)).json();
  await runWithReporterContext(contexts[1], () => editorialTransaction('runtime', async checkpoint => {
    checkpoint.factChecks![0].history.unshift({ checkedAt: '2022-01-01T12:00:00Z', verdict: 'validated' });
  }, true, 'reporter.edit', { productions: [], parts: [], sources: 'none', runs: 'none', pipelines: false, items: { fact_check: [legacy.id] } }));
  const updated = await (await memoryApi(legacy.id)).json(); assert.equal(updated.evidence.legacy.factCheck.history.length, legacyCheck.history.length + 1);
  assert.equal(updated.evidence.revision, before.evidence.revision); assert.equal(updated.check, null);
  await runWithReporterContext(contexts[1], () => editorialTransaction('runtime', async checkpoint => {
    checkpoint.state.sources[0].title = 'Updated synthetic legacy source';
  }, true, 'reporter.edit', { productions: [], parts: [], sources: [legacy.ref.sourceId], runs: 'none', pipelines: false }));
  const renamed = await (await memoryApi(legacy.id)).json(); assert.equal(renamed.material.title, 'Updated synthetic legacy source');
  assert.equal(renamed.evidence.revision, updated.evidence.revision); assert.deepEqual(renamed.evidence.legacy.citation, updated.evidence.legacy.citation);
});

test('legacy ID collisions report a conflict without moving an existing evidence to another material or aborting the batch', async () => {
  const record = await seedLegacyCitation('legacy-collision-source', 'Uma citação sintética já pertence a um material que precisa ser reconciliado explicitamente.');
  const raw = (await owner('SELECT doc FROM public.reporter_ed_sources WHERE portal_id=$1 AND source_id=$2', [PILOT, record.ref.sourceId]))[0].doc;
  const ref = { kind: 'source-version' as const, sourceId: record.ref.sourceId, sourceVersion: record.ref.sourceVersion, hash: record.sourceHash };
  const custom = { ...material, id: 'legacy-custom-material', source: ref };
  const existing: MemoryCitation = { ...citation, id: record.id, materialId: custom.id, text: record.text, legacyCitationId: record.id,
    anchor: { source: ref, excerpt: record.text, spans: [{ segmentId: raw.versions[0].content.segments[0].id, from: 0, to: record.text.length }] } };
  await session(contexts[1], async client => {
    await put(client, { kind: 'material', id: custom.id, expected: null, doc: custom, sourceId: record.ref.sourceId, productionId: record.productionId });
    await put(client, { ...evidenceChange(existing), parentId: custom.id });
  });
  assert.equal((await backfillLegacy()).find(item => item.id === record.id)?.state, 'id_conflict');
  assert.deepEqual((await read(contexts[1], 'evidence', record.id))!.doc, existing);
  assert.deepEqual((await owner("SELECT doc FROM public.reporter_ed_items WHERE portal_id=$1 AND kind='citation' AND item_id=$2", [PILOT, record.id]))[0].doc, record);
});

let articlePublicId: string, articlePrivateId: string, articleOriginalBody: import('../../src/domain/article.ts').ArticleBody;
async function seedArticle(productionId: string, id: string, kind: 'piece' | 'version', body: import('../../src/domain/article.ts').ArticleBody, at: string,
  sourceRef?: import('../../src/domain/refs.ts').SourceVersionRef) {
  const { articleHash } = await import('../../src/domain/article.ts');
  const versionSource = sourceRef ?? { kind: 'source-version', sourceId: legacy.ref.sourceId, sourceVersion: 1, hash: legacy.sourceHash };
  const doc = kind === 'piece' ? { id, productionId, kind: 'article', slug: 'article', createdAt: at, createdBy: contexts[1].actor,
    draft: { body, revision: 7, inputs: [], sources: [versionSource], updatedAt: at, updatedBy: contexts[1].actor } }
    : { id, pieceId: 'article-public-piece', number: 1, body, hash: articleHash(body), origin: 'edit', inputs: [], sources: [versionSource], createdAt: at, createdBy: contexts[1].actor };
  await owner('INSERT INTO public.reporter_ed_parts(portal_id,kind,part_id,production_id,doc,seq) VALUES($1,$2,$3,$4,$5,1)', [PILOT, kind, id, productionId, JSON.stringify(doc)]);
}
async function backfillArticles() {
  const items: import('../../src/domain/editorial-memory-legacy.ts').MemoryArticleReport['items'] = []; let after = null;
  for (let count = 0; ; count++) {
    assert.ok(count < 30, 'bounded fixture backfill must finish');
    const response = await memoryApi('reconcile/articles', { identity: identities[1], requestId: randomUUID(), input: { after, limit: 1 } });
    assert.equal(response.status, 200, await response.clone().text()); const page = await response.json(); items.push(...page.items); after = page.nextAfter;
    if (!after) return items;
  }
}

test('article-only citations keep stable scoped IDs and old aliases without exposing private curation or losing repeated quotes', async () => {
  const { articleEvidenceId } = await import('../../src/domain/editorial-memory-legacy.ts');
  await owner('INSERT INTO public.reporter_ed_productions(portal_id,production_id,doc,source_ids,seq) VALUES($1,$2,$3,$4,1)',
    [PILOT, 'article-public', JSON.stringify({ id: 'article-public', title: 'Public synthetic article', ownerId: contexts[1].actor }), [legacy.ref.sourceId]]);
  await owner('UPDATE public.reporter_ed_productions SET source_ids=array_append(source_ids,$3) WHERE portal_id=$1 AND production_id=$2', [PILOT, 'private-production', legacy.ref.sourceId]);
  articleOriginalBody = { type: 'article', title: 'Synthetic original article', blocks: [
    { id: 'double-quote', type: 'paragraph', inlines: [{ text: `“${legacy.text}” e “${legacy.text}”` }], sourceRefs: [legacy.ref] },
    { id: 'unmatched', type: 'quote', inlines: [{ text: 'Uma declaração sintética sem referência não pode virar evidência.' }] },
  ] };
  await seedArticle('article-public', 'article-public-piece', 'piece', articleOriginalBody, '2025-02-03T12:00:00Z');
  const single = { ...articleOriginalBody, blocks: [articleOriginalBody.blocks[0]] };
  await seedArticle('article-public', 'article-public-version', 'version', single, '2024-02-03T12:00:00Z');
  await seedArticle('private-production', 'article-private-piece', 'piece', single, '2025-02-03T12:00:00Z');
  await seedArticle('legacy-production', 'article-curated-piece', 'piece', single, '2025-02-03T12:00:00Z');
  const reports = await backfillArticles();
  articlePublicId = articleEvidenceId(legacy.id, 'article-public', legacy.ref); articlePrivateId = articleEvidenceId(legacy.id, 'private-production', legacy.ref);
  assert.notEqual(articlePublicId, articlePrivateId); assert.ok(reports.some(item => item.id === articlePublicId && item.state === 'imported'));
  assert.ok(reports.some(item => item.state === 'unmatched')); assert.ok(reports.some(item => item.id === legacy.id && item.state === 'unchanged'));
  assert.equal(reports.find(item => item.state === 'unmatched')?.productionId, 'article-public');
  const shown = await (await memoryApi(articlePublicId)).json(); assert.equal(shown.evidence.legacyCitationId, legacy.id); assert.equal(shown.evidence.text, legacy.text);
  assert.equal(shown.evidence.legacy.article.id, 'article-public-piece'); assert.equal(shown.evidence.metadata.recordedOn, null, 'another production curation must not become public metadata');
  assert.equal(shown.evidence.legacy.citation.relevance, ''); assert.equal(shown.evidence.legacy.citation.podcastName, undefined);
  assert.equal(shown.check, null); assert.equal(shown.uses.inserted, 0, 'evidence import alone is not an occurrence migration');
  const aliases = await (await memoryApi(`legacy/${legacy.id}`)).json(); assert.deepEqual(aliases.map((entry: { id: string }) => entry.id).sort(), [articlePublicId, legacy.id].sort());
  assert.equal((await memoryApi(articlePrivateId)).status, 404); assert.equal((await memoryApi(`${articlePrivateId}/article`)).status, 404);
  assert.equal((await (await memoryApi(`legacy/${legacy.id}`, { identity: identities[0], slug: 'memory-second' })).json()).length, 0);
  const before = shown.revisions.total;
  const again = await backfillArticles(); assert.ok(!again.some(item => item.state === 'imported' || item.state === 'updated'));
  assert.equal((await (await memoryApi(articlePublicId)).json()).revisions.total, before);
  await assert.rejects(session(contexts[1], client => client.query('SELECT * FROM public.reporter_memory_articles')), denied);
  await assert.rejects(session(contexts[1], client => client.query('DELETE FROM public.reporter_memory_articles')), denied);
});

test('original article snapshots survive overwritten drafts and partial migration refuses a changed resume document', async () => {
  const first = await memoryApi('reconcile/articles', { identity: identities[1], requestId: randomUUID(), input: { limit: 1 } });
  assert.equal(first.status, 200); const page = await first.json(); assert.equal(page.nextAfter.offset, 1);
  const original = await memoryApi(`${articlePublicId}/article`); assert.equal(original.status, 200); const saved = await original.json();
  assert.deepEqual(saved.doc.draft.body, articleOriginalBody); assert.equal(saved.importedBy, contexts[1].actor); assert.ok(Date.parse(saved.importedAt));
  const empty = { type: 'article', title: 'Synthetic overwritten draft', blocks: [] };
  await owner("UPDATE public.reporter_ed_parts SET doc=jsonb_set(doc,'{draft,body}',$3::jsonb) WHERE portal_id=$1 AND kind='piece' AND part_id=$2", [PILOT, 'article-public-piece', JSON.stringify(empty)]);
  const stale = await memoryApi('reconcile/articles', { identity: identities[1], requestId: randomUUID(), input: { after: page.nextAfter, limit: 1 } }); assert.equal(stale.status, 409);
  assert.deepEqual((await (await memoryApi(`${articlePublicId}/article`)).json()).doc.draft.body, articleOriginalBody);
  db.migrate(); assert.deepEqual((await (await memoryApi(`${articlePublicId}/article`)).json()).doc.draft.body, articleOriginalBody);
});

test('article provenance resolves legacy divergence against its saved original after the draft was replaced', async () => {
  const original = await (await memoryApi(articlePublicId)).json();
  const corrected = await memoryApi(`${articlePublicId}/correction`, { identity: identities[1], requestId: randomUUID(), input: {
    expected: memoryEvidenceRef(original.evidence), reason: 'Synthetic article curation', changes: { kind: 'citation', metadata: { edition: 'Curated edition' } },
  } }); assert.equal(corrected.status, 200);
  await owner("UPDATE public.reporter_ed_sources SET doc=jsonb_set(doc,'{recordedOn}',to_jsonb('2019-02-03'::text)) WHERE portal_id=$1 AND source_id=$2", [PILOT, legacy.ref.sourceId]);
  await backfillArticles(); const conflict = await (await memoryApi(articlePublicId)).json();
  assert.equal(conflict.evidence.legacy.state, 'conflict'); assert.equal(conflict.evidence.metadata.edition, 'Curated edition');
  const input = { expected: memoryEvidenceRef(conflict.evidence), legacyHash: conflict.evidence.legacy.hash, choice: 'keep_bank', reason: 'Keep explicitly curated metadata' };
  const response = await memoryApi(`${articlePublicId}/legacy`, { identity: identities[1], requestId: randomUUID(), input });
  assert.equal(response.status, 200, await response.clone().text()); const resolved = await response.json(); assert.equal(resolved.evidence.legacy.state, 'synchronized');
  assert.equal(resolved.evidence.metadata.edition, 'Curated edition'); assert.equal(resolved.eligibility.usable, false);
  assert.equal((await memoryApi(`${articlePublicId}/legacy`, { requestId: randomUUID(), input })).status, 403);
});

test('historical article originals remain addressable after a newer observed article replaces the evidence provenance', async () => {
  const previous = await (await memoryApi(`${articlePublicId}/article`)).json();
  const next = { ...articleOriginalBody, title: 'New synthetic article snapshot' };
  await owner("UPDATE public.reporter_ed_parts SET doc=jsonb_set(doc,'{draft}',(doc->'draft')||$3::jsonb) WHERE portal_id=$1 AND kind='piece' AND part_id=$2",
    [PILOT, 'article-public-piece', JSON.stringify({ body: next, revision: 8, updatedAt: '2026-02-03T12:00:00Z' })]);
  await backfillArticles();
  const current = await (await memoryApi(`${articlePublicId}/article`)).json(); assert.equal(current.doc.draft.body.title, next.title);
  assert.notEqual(current.origin.storageHash, previous.origin.storageHash);
  const historical = await memoryApi(`${articlePublicId}/article?snapshot=${previous.origin.storageHash}`); assert.equal(historical.status, 200);
  assert.deepEqual((await historical.json()).doc.draft.body, articleOriginalBody);
  assert.equal((await memoryApi(`${articlePublicId}/article?snapshot=${'f'.repeat(32)}`)).status, 404);
  assert.equal((await memoryApi(`${articlePublicId}/article?snapshot=invalid`)).status, 422);
  assert.equal((await memoryApi(`${articlePublicId}/article?actor=forged`)).status, 422);
  assert.equal((await memoryApi('reconcile/articles', { identity: identities[1], requestId: randomUUID(), input: {
    after: { productionId: 'article-public', kind: 'piece', id: 'article-public-piece', offset: 10 ** 12, storageHash: previous.origin.storageHash },
  } })).status, 422);
  assert.equal((await memoryApi(`${articlePublicId}/article?snapshot=${previous.origin.storageHash}`, { identity: identities[0], slug: 'memory-second' })).status, 404);
});

test('same words from two speakers do not inherit the other voice or its curated identity', async () => {
  const { citationFromReference } = await import('../../src/domain/citation-library.ts');
  const { articleEvidenceId } = await import('../../src/domain/editorial-memory-legacy.ts');
  const text = 'As inscrições sintéticas foram abertas para cem participantes do curso.';
  const original = createTranscriptSource({ workspaceId: PILOT, title: 'Synthetic voices', origin: 'interview', authorized: true,
    parsed: { format: 'speaker-lines', speakers: ['Ana', 'Bia'], segments: [{ id: 'ana-segment', speaker: 'Ana', text }, { id: 'bia-segment', speaker: 'Bia', text }], warnings: [] },
    speakerPeople: { Ana: contexts[1].actor, Bia: contexts[0].actor } }, { actorId: contexts[1].actor, now: '2025-01-01T00:00:00Z', newId: () => 'multi-voice-source' });
  const productionId = 'voice-production';
  await owner('INSERT INTO public.reporter_ed_sources(portal_id,source_id,doc,seq) VALUES($1,$2,$3,1)', [PILOT, original.id, JSON.stringify(original)]);
  await owner('INSERT INTO public.reporter_ed_productions(portal_id,production_id,doc,source_ids,seq) VALUES($1,$2,$3,$4,1)',
    [PILOT, productionId, JSON.stringify({ id: productionId, title: 'Synthetic voices', ownerId: contexts[1].actor }), [original.id]]);
  const refs = ['ana-segment', 'bia-segment'].map(segmentId => ({ kind: 'source' as const, sourceId: original.id, sourceVersion: 1, locator: { type: 'segment' as const, segmentId } }));
  const body: import('../../src/domain/article.ts').ArticleBody = { type: 'article', title: 'Synthetic voices', blocks: refs.map((ref, index) => ({
    id: `voice-${index}`, type: 'quote', inlines: [{ text }], sourceRefs: [ref],
  })) };
  const curated = citationFromReference(original, refs[1], text, productionId, '2025-01-01T00:00:00Z')!;
  await owner("INSERT INTO public.reporter_ed_items(portal_id,kind,item_id,production_id,doc,seq) VALUES($1,'citation',$2,$3,$4,1)", [PILOT, curated.id, productionId, JSON.stringify(curated)]);
  await seedArticle(productionId, 'voices-piece', 'piece', body, '2025-01-01T00:00:00Z', toSourceVersionRef(original));
  await backfillArticles(); const aId = articleEvidenceId(curated.id, productionId, refs[0]);
  const a = await (await memoryApi(aId)).json(), b = await (await memoryApi(curated.id)).json();
  assert.equal(a.evidence.personId, contexts[1].actor); assert.equal(a.evidence.anchor.spans[0].segmentId, 'ana-segment');
  assert.equal(b.evidence.personId, contexts[0].actor); assert.equal(b.evidence.anchor.spans[0].segmentId, 'bia-segment');
  const aliases = await (await memoryApi(`legacy/${curated.id}`)).json(); assert.deepEqual(aliases.map((item: { id: string }) => item.id).sort(), [aId, curated.id].sort());
  const ambiguous: typeof body = { ...body, blocks: [{ ...body.blocks[0], sourceRefs: refs }] };
  await seedArticle(productionId, 'ambiguous-voices', 'piece', ambiguous, '2026-01-01T00:00:00Z', toSourceVersionRef(original));
  assert.ok((await backfillArticles()).some(item => item.articleId === 'ambiguous-voices' && item.state === 'ambiguous'));
  assert.equal((await (await memoryApi(aId)).json()).evidence.personId, contexts[1].actor);
});

let liveCitation: typeof legacy, liveId: string;
async function saveLiveArticle(title: string, role: 'runtime' | 'worker' = 'runtime') {
  const { runWithReporterContext } = await import('../../src/server/request-context.ts');
  const { runWithWorkerContext } = await import('../../src/server/worker-context.ts');
  const { editorialTransaction } = await import('../../src/server/editorial.ts');
  const operation = () => editorialTransaction(role, async checkpoint => {
    const piece = checkpoint.state.productions.find(entry => entry.production.id === 'live-production')!.pieces[0];
    piece.draft = { ...piece.draft, revision: piece.draft.revision + 1, updatedAt: new Date().toISOString(), body: {
      type: 'article', title, blocks: [{ id: 'live-quote', type: 'quote', inlines: [{ text: liveCitation.text }], sourceRefs: [liveCitation.ref] }],
    } };
  }, true, 'reporter.edit', { productions: ['live-production'], parts: ['piece'], sources: 'none', runs: 'none', pipelines: false });
  return role === 'runtime' ? runWithReporterContext(contexts[1], operation)
    : runWithWorkerContext({ tenant: contexts[1].tenant, portal: PILOT, actor: contexts[1].actor }, operation);
}

test('article writes project new evidence atomically without a manual workspace backfill or invented uses', async () => {
  const { articleEvidenceId } = await import('../../src/domain/editorial-memory-legacy.ts');
  liveCitation = await seedLegacyCitation('live-source', 'A instituição sintética abriu trezentas vagas para o curso de formação.', 'live-production');
  await owner("DELETE FROM public.reporter_ed_items WHERE portal_id=$1 AND kind='citation' AND item_id=$2", [PILOT, liveCitation.id]);
  await owner("UPDATE public.reporter_ed_productions SET doc=doc||$2::jsonb WHERE portal_id=$1 AND production_id='live-production'", [PILOT,
    JSON.stringify({ sourceIds: ['live-source'], workspaceId: PILOT, flowId: 'hard-news', brief: { revision: 1, sections: 2, size: 'standard' }, plan: ['article'], relations: [],
      createdAt: '2026-01-01T00:00:00Z', createdBy: contexts[1].actor, updatedAt: '2026-01-01T00:00:00Z' })]);
  await seedArticle('live-production', 'live-piece', 'piece', { type: 'article', title: 'Empty synthetic article', blocks: [] }, '2026-01-01T00:00:00Z',
    { kind: 'source-version', sourceId: liveCitation.ref.sourceId, sourceVersion: 1, hash: liveCitation.sourceHash });
  liveId = articleEvidenceId(liveCitation.id, 'live-production', liveCitation.ref);
  assert.equal((await memoryApi(liveId)).status, 404);
  await saveLiveArticle('Synthetic saved article');
  const response = await memoryApi(liveId); assert.equal(response.status, 200, await response.clone().text()); const detail = await response.json();
  assert.equal(detail.evidence.text, liveCitation.text); assert.equal(detail.evidence.legacy.importedBy, contexts[1].actor);
  assert.equal(detail.revisions.total, 1); assert.equal(detail.uses.inserted, 0); assert.equal(detail.eligibility.usable, false);
  const original = await (await memoryApi(`${liveId}/article`)).json(); assert.equal(original.doc.draft.body.title, 'Synthetic saved article');
  assert.equal(original.importedBy, contexts[1].actor); assert.equal((await memoryApi(liveId, { identity: identities[0], slug: 'memory-second' })).status, 404);
  assert.equal((await session(otherWriter, async client => (await client.query('SELECT public.reporter_memory_article_entry($1,$2,$3) AS value',
    ['private-production', 'piece', 'article-private-piece'])).rows[0].value)), null);
});

test('source and legacy check writes refresh saved article variants after their live quote disappears', async () => {
  const { runWithReporterContext } = await import('../../src/server/request-context.ts');
  const { editorialTransaction } = await import('../../src/server/editorial.ts');
  const original = await (await memoryApi(`${liveId}/article`)).json();
  await owner("UPDATE public.reporter_ed_parts SET doc=jsonb_set(doc,'{draft,body}', $3::jsonb) WHERE portal_id=$1 AND part_id=$2", [PILOT, 'live-piece',
    JSON.stringify({ type: 'article', title: 'Quote removed from current draft', blocks: [] })]);
  await runWithReporterContext(contexts[1], () => editorialTransaction('runtime', async checkpoint => {
    checkpoint.state.sources[0].recordedOn = '2020-02-02'; checkpoint.state.sources[0].title = 'Renamed synthetic live source';
  }, true, 'reporter.edit', { productions: [], parts: [], sources: ['live-source'], runs: 'none', pipelines: false }));
  const updated = await (await memoryApi(liveId)).json(); assert.equal(updated.evidence.metadata.recordedOn, '2020-02-02');
  assert.equal(updated.material.title, 'Renamed synthetic live source'); assert.deepEqual((await (await memoryApi(`${liveId}/article`)).json()).doc, original.doc);
  const check = { ...legacyCheck, id: liveCitation.id, history: [] };
  await owner("INSERT INTO public.reporter_ed_items(portal_id,kind,item_id,production_id,doc,seq) VALUES($1,'fact_check',$2,$3,$4,1)", [PILOT, liveCitation.id, 'live-production', JSON.stringify(check)]);
  await runWithReporterContext(contexts[1], () => editorialTransaction('runtime', async checkpoint => {
    checkpoint.factChecks![0].history.unshift({ checkedAt: '2022-01-01T00:00:00Z', verdict: 'validated' });
  }, true, 'reporter.edit', { productions: [], parts: [], sources: 'none', runs: 'none', pipelines: false, items: { fact_check: [liveCitation.id] } }));
  const checked = await (await memoryApi(liveId)).json(); assert.equal(checked.evidence.legacy.factCheck.history.length, 1);
  assert.equal(checked.check, null); assert.equal(checked.eligibility.usable, false);
});

test('a bank audit failure rolls the article, evidence history and original snapshot back together', async () => {
  const before = await (await memoryApi(liveId)).json();
  const original = (await owner("SELECT doc FROM public.reporter_ed_parts WHERE portal_id=$1 AND part_id='live-piece'", [PILOT]))[0].doc;
  const count = (await owner("SELECT count(*)::int AS n FROM public.reporter_memory_articles WHERE portal_id=$1 AND id='live-piece'", [PILOT]))[0].n;
  await owner("CREATE FUNCTION public.fail_memory_article_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='memory.legacy.article' THEN RAISE EXCEPTION 'synthetic article audit failure'; END IF; RETURN NEW; END $$");
  await owner('CREATE TRIGGER fail_memory_article_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.fail_memory_article_audit()');
  try { await assert.rejects(saveLiveArticle('Synthetic rolled back article'), /synthetic article audit failure/); }
  finally { await owner('DROP TRIGGER fail_memory_article_audit ON public.audit_log'); await owner('DROP FUNCTION public.fail_memory_article_audit()'); }
  assert.deepEqual((await owner("SELECT doc FROM public.reporter_ed_parts WHERE portal_id=$1 AND part_id='live-piece'", [PILOT]))[0].doc, original);
  assert.equal((await owner("SELECT count(*)::int AS n FROM public.reporter_memory_articles WHERE portal_id=$1 AND id='live-piece'", [PILOT]))[0].n, count);
  const after = await (await memoryApi(liveId)).json(); assert.deepEqual(after.evidence, before.evidence); assert.equal(after.revisions.total, before.revisions.total);
});

test('attributed worker article writes use the initiating actor and disabled ceilings leave editorial writes compatible', async () => {
  await saveLiveArticle('Synthetic worker article', 'worker');
  const current = await (await memoryApi(`${liveId}/article`)).json(); assert.equal(current.doc.draft.body.title, 'Synthetic worker article');
  assert.equal(current.importedBy, contexts[1].actor);
  process.env.REPORTER_MEMORY_MODE = 'off';
  try { await saveLiveArticle('Synthetic article with memory disabled'); } finally { process.env.REPORTER_MEMORY_MODE = 'on'; }
  assert.deepEqual(await (await memoryApi(`${liveId}/article`)).json(), current);
  const stored = (await owner("SELECT doc FROM public.reporter_ed_parts WHERE portal_id=$1 AND part_id='live-piece'", [PILOT]))[0].doc;
  assert.equal(stored.draft.body.title, 'Synthetic article with memory disabled');
});

test('automatic article refresh preserves explicit bank corrections and blocks unresolved divergence', async () => {
  const before = await (await memoryApi(liveId)).json();
  const correction = await memoryApi(`${liveId}/correction`, { identity: identities[1], requestId: randomUUID(), input: {
    expected: memoryEvidenceRef(before.evidence), reason: 'Synthetic edition confirmed by an editor', changes: { kind: 'citation', metadata: { edition: 'Editorial edition' } },
  } }); assert.equal(correction.status, 200, await correction.clone().text());
  const { runWithReporterContext } = await import('../../src/server/request-context.ts');
  const { editorialTransaction } = await import('../../src/server/editorial.ts');
  await runWithReporterContext(contexts[1], () => editorialTransaction('runtime', async checkpoint => {
    checkpoint.state.sources[0].recordedOn = '2020-03-03';
  }, true, 'reporter.edit', { productions: [], parts: [], sources: ['live-source'], runs: 'none', pipelines: false }));
  const after = await (await memoryApi(liveId)).json(); assert.equal(after.evidence.metadata.edition, 'Editorial edition');
  assert.equal(after.evidence.metadata.recordedOn, '2020-02-02'); assert.equal(after.evidence.legacy.citation.recordedOn, '2020-03-03');
  assert.equal(after.evidence.legacy.state, 'conflict'); assert.equal(after.eligibility.usable, false);
  const review = await memoryApi(`${liveId}/review`, { requestId: randomUUID(), input: { evidence: memoryEvidenceRef(after.evidence), check: null,
    policyRevision: 1, previousSequence: 0, action: 'accept', reason: 'Unresolved source change', supports: [] } }); assert.equal(review.status, 409);
});

async function seedDuplicate(name: string, corrected = false) {
  const { articleEvidenceId } = await import('../../src/domain/editorial-memory-legacy.ts');
  const record = await seedLegacyCitation(`duplicate-source-${name}`, `A unidade sintética ${name} abriu cem vagas para a formação de novos profissionais.`, `duplicate-${name}`);
  await owner("DELETE FROM public.reporter_ed_items WHERE portal_id=$1 AND kind='citation' AND item_id=$2", [PILOT, record.id]);
  await seedArticle(record.productionId, `duplicate-piece-${name}`, 'piece', { type: 'article', title: 'Synthetic duplicate origin', blocks: [
    { id: 'quote', type: 'quote', inlines: [{ text: record.text }], sourceRefs: [record.ref] },
  ] }, '2025-01-01T00:00:00Z', { kind: 'source-version', sourceId: record.ref.sourceId, sourceVersion: 1, hash: record.sourceHash });
  await backfillArticles(); const id = articleEvidenceId(record.id, record.productionId, record.ref);
  if (corrected) {
    const original = await (await memoryApi(id)).json();
    const correction = await memoryApi(`${id}/correction`, { identity: identities[1], requestId: randomUUID(), input: { expected: memoryEvidenceRef(original.evidence),
      reason: 'Synthetic correction before curation', changes: { kind: 'citation', metadata: { edition: 'Corrected bank edition' } } } });
    assert.equal(correction.status, 200, await correction.clone().text());
  }
  return { id, record };
}
async function curateDuplicate(record: typeof legacy) {
  const { runWithReporterContext } = await import('../../src/server/request-context.ts');
  const { editorialTransaction } = await import('../../src/server/editorial.ts');
  await runWithReporterContext(contexts[1], () => editorialTransaction('runtime', async checkpoint => {
    (checkpoint.citations ??= []).push(record);
  }, true, 'reporter.edit', { productions: [], parts: [], sources: 'none', runs: 'none', pipelines: false, items: { citation: [record.id] } }));
}

test('later curation retires an unchanged article projection while preserving its original, decisions and snapshot pagination', async () => {
  const { id, record } = await seedDuplicate('automatic');
  const before = await (await memoryApi(id)).json(); const filters = { materialId: before.material.id };
  const snapshot = await query(contexts[1], filters);
  const accepted = await memoryApi(`${id}/review`, { requestId: randomUUID(), input: { evidence: memoryEvidenceRef(before.evidence), check: null,
    policyRevision: 1, previousSequence: 0, action: 'accept', reason: 'Synthetic original verified', supports: [] } }); assert.equal(accepted.status, 200);
  await curateDuplicate(record);
  const retired = await (await memoryApi(id)).json(), canonical = await (await memoryApi(record.id)).json();
  assert.equal(retired.evidence.status, 'superseded'); assert.equal(retired.evidence.deduplication.canonicalId, record.id);
  assert.deepEqual(retired.evidence.deduplication.canonical, memoryEvidenceRef(canonical.evidence));
  assert.equal(retired.evidence.deduplication.choice, 'automatic'); assert.equal(retired.evidence.deduplication.personId, contexts[1].actor);
  assert.ok(Date.parse(retired.evidence.deduplication.at)); assert.equal(retired.decisions.total, 1); assert.equal(retired.revisions.total, 2);
  assert.equal(retired.eligibility.usable, false); assert.equal(canonical.eligibility.usable, false); assert.equal(canonical.decisions.total, 0);
  assert.equal(canonical.uses.approved, 0); assert.equal((await memoryApi(`${id}/article`)).status, 200);
  assert.deepEqual((await query(contexts[1], filters)).items.map(item => item.evidence.id), [record.id]);
  assert.deepEqual((await query(contexts[1], { ...filters, status: 'superseded' })).items.map(item => item.evidence.id), [id]);
  assert.equal((await query(contexts[1], { ...filters, status: 'all' })).total, 2);
  assert.deepEqual((await query(contexts[1], filters, snapshot.snapshot)).items.map(item => item.evidence.id), [id]);
  assert.deepEqual((await (await memoryApi(`legacy/${record.id}`)).json()).map((item: { id: string }) => item.id), [record.id]);
  await backfillArticles(); await backfillLegacy();
  const repeat = await (await memoryApi(id)).json(); assert.equal(repeat.revisions.total, 2); assert.equal(repeat.evidence.status, 'superseded');
});

test('corrected duplicates wait for an explicit choice and preserve both originals and the old acceptance', async () => {
  const { id, record } = await seedDuplicate('corrected', true);
  const original = await (await memoryApi(id)).json();
  const accepted = await memoryApi(`${id}/review`, { requestId: randomUUID(), input: { evidence: memoryEvidenceRef(original.evidence), check: null,
    policyRevision: 1, previousSequence: 0, action: 'accept', reason: 'Confirmed corrected metadata', supports: [] } }); assert.equal(accepted.status, 200);
  await curateDuplicate(record);
  const pending = await (await memoryApi(id)).json(), canonical = await (await memoryApi(record.id)).json();
  assert.equal(pending.evidence.status, 'active'); assert.equal(pending.evidence.deduplication.state, 'pending');
  assert.equal(pending.evidence.metadata.edition, 'Corrected bank edition'); assert.equal(pending.eligibility.usable, false);
  assert.equal(pending.decisions.total, 1); assert.equal(canonical.evidence.metadata.edition, null);
  await assert.rejects(session(contexts[1], client => put(client, { kind: 'decision', id: 'cannot-accept-pending-duplicate', expected: null,
    parentKind: 'evidence', parentId: id, doc: { id: 'cannot-accept-pending-duplicate', workspaceId: PILOT, evidence: memoryEvidenceRef(pending.evidence), check: null,
      policyRevision: 1, sequence: 2, action: 'accept', reason: 'Cannot bypass duplicate guard in SQL', supports: [] } })), conflict);
  const stored = await read(contexts[1], 'evidence', id), erased = structuredClone(pending.evidence);
  delete erased.deduplication; erased.revision++;
  await assert.rejects(session(contexts[1], client => put(client, { kind: 'evidence', id, expected: stored!.storage_revision, doc: erased,
    parentKind: 'material', parentId: pending.material.id, fingerprint: memoryEvidenceRef(erased).hash })), conflict);
  const refused = await memoryApi(`${id}/review`, { requestId: randomUUID(), input: { evidence: memoryEvidenceRef(pending.evidence), check: null,
    policyRevision: 1, previousSequence: 1, action: 'accept', reason: 'Cannot bypass duplicate resolution', supports: [] } }); assert.equal(refused.status, 409);
  const input = { expected: memoryEvidenceRef(pending.evidence), canonical: memoryEvidenceRef(canonical.evidence), choice: 'keep_variant', reason: 'Preserve the corrected bank metadata' };
  for (const identity of [identities[2], identities[3]]) assert.equal((await memoryApi(`${id}/duplicate`, { identity, requestId: randomUUID(), input })).status, 403);
  assert.equal((await memoryApi(`${id}/duplicate`, { identity: identities[1], requestId: randomUUID(), input: { ...input, personId: 'forged' } })).status, 422);
  assert.equal((await memoryApi(`${id}/duplicate`, { identity: identities[0], slug: 'memory-second', requestId: randomUUID(), input })).status, 404);
  const options = { identity: identities[1], requestId: randomUUID(), input };
  const currentAcceptance = await memoryApi(`${record.id}/review`, { requestId: randomUUID(), input: { evidence: memoryEvidenceRef(canonical.evidence), check: null,
    policyRevision: 1, previousSequence: 0, action: 'accept', reason: 'Synthetic current curation verified', supports: [] } }); assert.equal(currentAcceptance.status, 200);
  const resolution = await memoryApi(`${id}/duplicate`, options); assert.equal(resolution.status, 200, await resolution.clone().text()); const kept = await resolution.json();
  assert.equal(kept.evidence.metadata.edition, 'Corrected bank edition'); assert.equal(kept.evidence.correction.personId, contexts[1].actor);
  assert.equal(kept.evidence.correction.reason, input.reason); assert.equal(kept.eligibility.usable, false);
  const replay = await memoryApi(`${id}/duplicate`, options); assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), kept);
  assert.equal((await memoryApi(`${id}/duplicate`, { ...options, input: { ...input, reason: 'Different payload' } })).status, 409);
  const retired = await (await memoryApi(id)).json(); assert.equal(retired.evidence.metadata.edition, 'Corrected bank edition');
  assert.equal(retired.evidence.deduplication.choice, 'keep_variant'); assert.equal(retired.evidence.status, 'superseded');
  assert.deepEqual((await owner("SELECT doc FROM public.reporter_ed_items WHERE portal_id=$1 AND kind='citation' AND item_id=$2", [PILOT, record.id]))[0].doc, record);
  const audits = await owner("SELECT user_id,after_data FROM public.audit_log WHERE action='memory.duplicate.supersede' AND after_data->>'id'=$1", [id]);
  assert.equal(audits.length, 1); assert.equal(audits[0].user_id, contexts[1].actor); assert.equal(audits[0].after_data.deduplication.reason, input.reason);
});

test('duplicate resolution guards both revisions and concurrent alternatives have exactly one audited winner', async () => {
  const { id, record } = await seedDuplicate('concurrent', true); await curateDuplicate(record);
  const pending = await (await memoryApi(id)).json(), canonical = await (await memoryApi(record.id)).json();
  const input = { expected: memoryEvidenceRef(pending.evidence), canonical: memoryEvidenceRef(canonical.evidence), choice: 'use_curated', reason: 'Use the current curated metadata' };
  for (const key of ['expected', 'canonical'] as const) {
    const stale = await memoryApi(`${id}/duplicate`, { identity: identities[1], requestId: randomUUID(), input: { ...input, [key]: { ...input[key], revision: input[key].revision + 1 } } });
    assert.equal(stale.status, 409);
  }
  const results = await Promise.all(['use_curated', 'keep_variant'].map(choice => memoryApi(`${id}/duplicate`, { identity: identities[1], requestId: randomUUID(), input: { ...input, choice } })));
  assert.deepEqual(results.map(response => response.status).sort(), [200, 409]);
  const after = await (await memoryApi(id)).json(), target = await (await memoryApi(record.id)).json();
  assert.equal(after.evidence.status, 'superseded'); assert.equal(after.evidence.metadata.edition, 'Corrected bank edition');
  assert.equal(target.evidence.metadata.edition, after.evidence.deduplication.choice === 'keep_variant' ? 'Corrected bank edition' : null);
  assert.equal((await owner("SELECT count(*)::int AS n FROM public.audit_log WHERE action='memory.duplicate.supersede' AND after_data->>'id'=$1", [id]))[0].n, 1);
});

test('failed duplicate audit rolls canonical correction back and choosing curation preserves the retired variant history', async () => {
  const { id, record } = await seedDuplicate('rollback', true); await curateDuplicate(record);
  const pending = await (await memoryApi(id)).json(), canonical = await (await memoryApi(record.id)).json();
  const input = { expected: memoryEvidenceRef(pending.evidence), canonical: memoryEvidenceRef(canonical.evidence), choice: 'keep_variant', reason: 'Synthetic resolution audit failure' };
  await owner("CREATE FUNCTION public.fail_memory_duplicate_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='memory.duplicate.supersede' THEN RAISE EXCEPTION 'synthetic duplicate audit failure'; END IF; RETURN NEW; END $$");
  await owner('CREATE TRIGGER fail_memory_duplicate_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.fail_memory_duplicate_audit()');
  try {
    const failed = await memoryApi(`${id}/duplicate`, { identity: identities[1], requestId: randomUUID(), input }); assert.equal(failed.status, 500);
  } finally { await owner('DROP TRIGGER fail_memory_duplicate_audit ON public.audit_log'); await owner('DROP FUNCTION public.fail_memory_duplicate_audit()'); }
  assert.deepEqual((await (await memoryApi(record.id)).json()).evidence, canonical.evidence);
  assert.deepEqual((await (await memoryApi(id)).json()).evidence, pending.evidence);
  const result = await memoryApi(`${id}/duplicate`, { identity: identities[1], requestId: randomUUID(), input: { ...input, choice: 'use_curated', reason: 'Keep the existing curated metadata' } });
  assert.equal(result.status, 200, await result.clone().text()); assert.deepEqual((await result.json()).evidence, canonical.evidence);
  const retired = await (await memoryApi(id)).json(); assert.equal(retired.evidence.deduplication.choice, 'use_curated');
  assert.equal(retired.evidence.metadata.edition, 'Corrected bank edition'); assert.equal(retired.revisions.total, pending.revisions.total + 1);
});

test('duplicate consolidation cannot merge productions or two speakers sharing the same words', async () => {
  const { articleEvidenceId } = await import('../../src/domain/editorial-memory-legacy.ts');
  const voice = (await owner("SELECT doc FROM public.reporter_ed_items WHERE portal_id=$1 AND kind='citation' AND production_id='voice-production'", [PILOT]))[0].doc;
  const voiceVariant = articleEvidenceId(voice.id, 'voice-production', { ...voice.ref, locator: { type: 'segment', segmentId: 'ana-segment' } });
  for (const [id, target] of [[articlePublicId, legacy.id], [voiceVariant, voice.id]]) {
    const before = await (await memoryApi(id)).json(), canonical = await (await memoryApi(target)).json();
    const refused = await memoryApi(`${id}/duplicate`, { identity: identities[1], requestId: randomUUID(), input: {
      expected: memoryEvidenceRef(before.evidence), canonical: memoryEvidenceRef(canonical.evidence), choice: 'use_curated', reason: 'Invalid consolidation across origins',
    } }); assert.equal(refused.status, 409);
    assert.deepEqual((await (await memoryApi(id)).json()).evidence, before.evidence);
  }
});

async function seedSelectable(id: string, kind: 'citation' | 'statistic' = 'citation', productionId: string | null = null) {
  const original = createTranscriptSource({ workspaceId: PILOT, title: `Synthetic selection ${id}`, origin: 'interview', authorized: true,
    parsed: parseTranscript('Ana Exemplo: A unidade sintética treinou 240 pessoas no período observado.', { format: 'speaker-lines' }),
    speakerPeople: { 'Ana Exemplo': contexts[1].actor } }, { actorId: contexts[1].actor, now: '2026-01-01T00:00:00Z', newId: () => `selection-source-${id}` });
  await owner('INSERT INTO public.reporter_ed_sources(portal_id,source_id,doc,seq) VALUES($1,$2,$3,1)', [PILOT, original.id, JSON.stringify(original)]);
  if (productionId) await owner('INSERT INTO public.reporter_ed_productions(portal_id,production_id,doc,source_ids,seq) VALUES($1,$2,$3,$4,1)',
    [PILOT, productionId, JSON.stringify({ id: productionId, ownerId: contexts[1].actor, title: 'Synthetic selection origin' }), [original.id]]);
  const selectedMaterial: MemoryMaterial = { ...material, id: `selection-material-${id}`, source: toSourceVersionRef(original) };
  const segment = original.versions[0].content.segments[0];
  const base = { id, workspaceId: PILOT, materialId: selectedMaterial.id, revision: 0, kinds: ['declared'] as const,
    anchor: { source: selectedMaterial.source, spans: [{ segmentId: segment.id, from: 0, to: segment.text.length }], excerpt: segment.text },
    metadata, status: 'active' as const, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', supersedes: null };
  const evidence = kind === 'citation' ? { ...base, kinds: [...base.kinds], kind: 'citation' as const, text: segment.text, personId: contexts[1].actor, authorConfirmed: true, legacyCitationId: null }
    : { ...statistic(id, 0), ...base, kinds: [...base.kinds], period: null };
  await session(contexts[1], async client => {
    await put(client, { kind: 'material', id: selectedMaterial.id, expected: null, doc: selectedMaterial, sourceId: original.id, ...(productionId ? { productionId } : {}) });
    await put(client, { kind: 'evidence', id, expected: null, doc: evidence, fingerprint: memoryEvidenceRef(evidence).hash, parentKind: 'material', parentId: selectedMaterial.id });
  });
  return evidence;
}
async function acceptSelectable(id: string) {
  const detail = await (await memoryApi(id)).json();
  const response = await memoryApi(`${id}/review`, { identity: identities[1], requestId: randomUUID(), input: { evidence: memoryEvidenceRef(detail.evidence), check: null,
    policyRevision: 1, previousSequence: detail.decisions.total, action: 'accept', reason: 'Synthetic selection evidence verified', supports: [] } });
  assert.equal(response.status, 200, await response.clone().text()); return response.json();
}
let selectionQuote: Awaited<ReturnType<typeof seedSelectable>>, selectionStatistic: typeof selectionQuote, savedSelection: import('../../src/domain/editorial-memory.ts').MemorySelection;

test('ordered multi-material selection captures exact review snapshots, actual actors and only selected events', async () => {
  selectionQuote = await seedSelectable('selection-quote'); selectionStatistic = await seedSelectable('selection-statistic', 'statistic');
  const decisions = await Promise.all([acceptSelectable(selectionQuote.id), acceptSelectable(selectionStatistic.id)]);
  const input = { baseRevision: 0, productionId: null, evidence: [memoryEvidenceRef(selectionStatistic), memoryEvidenceRef(selectionQuote)] };
  const options = { identity: identities[1], requestId: randomUUID(), input };
  const response = await memoryApi('selections', options); assert.equal(response.status, 200, await response.clone().text()); savedSelection = await response.json();
  assert.deepEqual(savedSelection.items.map(item => item.evidence), input.evidence);
  assert.deepEqual(savedSelection.items.map(item => item.decisionId), [decisions[1].id, decisions[0].id]);
  assert.equal(savedSelection.revision, 1); assert.equal(savedSelection.createdBy, contexts[1].actor); assert.equal(savedSelection.updatedBy, contexts[1].actor);
  assert.equal(savedSelection.createdAt, savedSelection.updatedAt); assert.ok(Date.parse(savedSelection.updatedAt));
  const replay = await memoryApi('selections', options); assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), savedSelection);
  const get = await memoryApi(`selections/${savedSelection.id}`); assert.equal(get.status, 200); assert.match(get.headers.get('cache-control')!, /no-store/);
  assert.deepEqual(await get.json(), savedSelection);
  const events = await owner("SELECT doc FROM public.reporter_memory_heads WHERE portal_id=$1 AND kind='use' AND doc->>'selectionId'=$2", [PILOT, savedSelection.id]);
  assert.equal(events.length, 2);
  for (const { doc } of events) { assert.equal(doc.stage, 'selected'); assert.equal(doc.personId, contexts[1].actor); assert.equal(doc.selectionRevision, 1); }
  for (const evidence of [selectionQuote, selectionStatistic]) {
    const detail = await (await memoryApi(evidence.id)).json(); assert.deepEqual(detail.uses, { selected: 1, inserted: 0, approved: 0, published: 0 });
    assert.equal((await query(contexts[1], { materialId: evidence.materialId, unused: true })).total, 1, 'selection does not consume the inserted-unused filter');
  }
  const audits = await owner("SELECT user_id,after_data FROM public.audit_log WHERE action='memory.selection.save' AND after_data->>'id'=$1", [savedSelection.id]);
  assert.equal(audits.length, 1); assert.equal(audits[0].user_id, contexts[1].actor); assert.deepEqual(audits[0].after_data, savedSelection);
});

test('reordering selection preserves its creator and original events, refuses rebinding and serializes concurrent edits', async () => {
  const input = { id: savedSelection.id, baseRevision: 1, productionId: null, evidence: savedSelection.items.map(item => item.evidence).reverse() };
  const response = await memoryApi('selections', { identity: identities[0], requestId: randomUUID(), input }); assert.equal(response.status, 200, await response.clone().text());
  savedSelection = await response.json(); assert.equal(savedSelection.revision, 2); assert.equal(savedSelection.createdBy, contexts[1].actor); assert.equal(savedSelection.updatedBy, contexts[0].actor);
  const rebound = await memoryApi('selections', { identity: identities[1], requestId: randomUUID(), input: { ...input, baseRevision: 2, productionId: 'private-production' } }); assert.equal(rebound.status, 409);
  const results = await Promise.all([selectionQuote, selectionStatistic].map(evidence => memoryApi('selections', { identity: identities[1], requestId: randomUUID(), input: {
    id: savedSelection.id, baseRevision: 2, productionId: null, evidence: [memoryEvidenceRef(evidence)],
  } })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal((await owner("SELECT count(*)::int AS n FROM public.reporter_memory_heads WHERE portal_id=$1 AND kind='use' AND doc->>'selectionId'=$2", [PILOT, savedSelection.id]))[0].n, 2);
  assert.equal((await owner("SELECT count(*)::int AS n FROM public.reporter_memory_history WHERE portal_id=$1 AND kind='selection' AND id=$2", [PILOT, savedSelection.id]))[0].n, 3);
});

test('selection refuses unreviewed, stale and unauthorized evidence without saving a partial selection or occurrence', async () => {
  const unreviewed = await seedSelectable('selection-unreviewed');
  const input = { id: 'selection-atomic-failure', baseRevision: 0, productionId: null, evidence: [memoryEvidenceRef(selectionQuote), memoryEvidenceRef(unreviewed)] };
  assert.equal((await memoryApi('selections', { identity: identities[1], requestId: randomUUID(), input })).status, 409);
  assert.equal((await memoryApi(`selections/${input.id}`)).status, 404);
  assert.equal((await owner("SELECT count(*)::int AS n FROM public.reporter_memory_heads WHERE portal_id=$1 AND kind='use' AND doc->>'selectionId'=$2", [PILOT, input.id]))[0].n, 0);
  const stale = await memoryApi('selections', { identity: identities[1], requestId: randomUUID(), input: { ...input, evidence: [{ ...memoryEvidenceRef(selectionQuote), revision: 99 }] } }); assert.equal(stale.status, 409);
  await owner("UPDATE public.reporter_ed_sources SET doc=jsonb_set(doc,'{rights,authorized}','false') WHERE portal_id=$1 AND source_id=$2", [PILOT, selectionQuote.anchor.source.sourceId]);
  try {
    assert.equal((await memoryApi('selections', { identity: identities[1], requestId: randomUUID(), input: { ...input, evidence: [memoryEvidenceRef(selectionQuote)] } })).status, 409);
  } finally { await owner("UPDATE public.reporter_ed_sources SET doc=jsonb_set(doc,'{rights,authorized}','true') WHERE portal_id=$1 AND source_id=$2", [PILOT, selectionQuote.anchor.source.sourceId]); }
  const correction = await memoryApi(`${selectionQuote.id}/correction`, { identity: identities[1], requestId: randomUUID(), input: { expected: memoryEvidenceRef(selectionQuote), reason: 'Synthetic changed edition',
    changes: { kind: 'citation', metadata: { edition: 'New edition' } } } }); assert.equal(correction.status, 200);
  const corrected = await correction.json();
  assert.equal((await memoryApi('selections', { identity: identities[1], requestId: randomUUID(), input: { ...input, evidence: [memoryEvidenceRef(corrected.evidence)] } })).status, 409, 'previous acceptance does not release a new revision');
});

test('selection reads and receipt replays recheck every material scope after a source production becomes private', async () => {
  const evidence = await seedSelectable('selection-private-item', 'citation', 'selection-private-origin'); await acceptSelectable(evidence.id);
  const input = { id: 'selection-privacy', baseRevision: 0, productionId: null, evidence: [memoryEvidenceRef(evidence)] };
  const options = { identity: identities[1], requestId: randomUUID(), input };
  const response = await memoryApi('selections', options); assert.equal(response.status, 200, await response.clone().text());
  await owner("UPDATE public.reporter_ed_productions SET doc=doc||$2::jsonb WHERE portal_id=$1 AND production_id='selection-private-origin'", [PILOT,
    JSON.stringify({ ownerId: contexts[0].actor, restrictedTo: [] })]);
  assert.equal((await memoryApi('selections/selection-privacy', { identity: identities[1] })).status, 404);
  assert.equal((await memoryApi('selections', options)).status, 404);
  assert.equal((await memoryApi('selections/selection-privacy', { identity: identities[0], slug: 'memory-second' })).status, 404);
  assert.equal(await read(contexts[1], 'selection', 'selection-privacy'), null, 'the SQL boundary hides references to newly private source productions');
  const target = await memoryApi('selections', { identity: { role: 'editor', subject: 'memory-other-writer', email: 'other-writer@memory.test', name: 'Other writer', emailVerified: true },
    requestId: randomUUID(), input: { baseRevision: 0, productionId: 'private-production', evidence: [memoryEvidenceRef(selectionStatistic)] } }); assert.equal(target.status, 403);
});

test('selection audit failure rolls events and selection history back, and only editors can write with unforgeable metadata', async () => {
  const input = { id: 'selection-audit-rollback', baseRevision: 0, productionId: null, evidence: [memoryEvidenceRef(selectionStatistic)] };
  await owner("CREATE FUNCTION public.fail_memory_selection_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='memory.selection.save' THEN RAISE EXCEPTION 'synthetic selection audit failure'; END IF; RETURN NEW; END $$");
  await owner('CREATE TRIGGER fail_memory_selection_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.fail_memory_selection_audit()');
  try { assert.equal((await memoryApi('selections', { identity: identities[1], requestId: randomUUID(), input })).status, 500); }
  finally { await owner('DROP TRIGGER fail_memory_selection_audit ON public.audit_log'); await owner('DROP FUNCTION public.fail_memory_selection_audit()'); }
  assert.equal((await memoryApi(`selections/${input.id}`)).status, 404);
  assert.equal((await owner("SELECT count(*)::int AS n FROM public.reporter_memory_heads WHERE portal_id=$1 AND kind='use' AND doc->>'selectionId'=$2", [PILOT, input.id]))[0].n, 0);
  for (const identity of [identities[2], identities[3]]) assert.equal((await memoryApi('selections', { identity, requestId: randomUUID(), input })).status, 403);
  for (const extra of [{ createdBy: contexts[0].actor }, { at: '2020-01-01T00:00:00Z' }, { workspaceId: second.portal }])
    assert.equal((await memoryApi('selections', { identity: identities[1], requestId: randomUUID(), input: { ...input, ...extra } })).status, 422);
  assert.equal((await memoryApi('selections', { identity: identities[1], input })).status, 422);
  const saved = await memoryApi('selections', { identity: identities[1], requestId: randomUUID(), input }); assert.equal(saved.status, 200, await saved.clone().text());
  assert.equal((await memoryApi(`selections/${input.id}?actor=forged`)).status, 422);
});

test('production-bound selections count distinct productions and current target privacy applies to saved selections and events', async () => {
  const before = await (await memoryApi(selectionStatistic.id)).json();
  await owner('INSERT INTO public.reporter_ed_productions(portal_id,production_id,doc,source_ids,seq) VALUES($1,$2,$3,$4,1)',
    [PILOT, 'selection-target', JSON.stringify({ id: 'selection-target', title: 'Synthetic selection target', ownerId: contexts[1].actor }), []]);
  const input = { baseRevision: 0, productionId: 'selection-target', evidence: [memoryEvidenceRef(selectionStatistic)] };
  const a = await memoryApi('selections', { identity: identities[1], requestId: randomUUID(), input }); assert.equal(a.status, 200, await a.clone().text()); const first = await a.json();
  const b = await memoryApi('selections', { identity: identities[1], requestId: randomUUID(), input }); assert.equal(b.status, 200);
  const unattached = await memoryApi('selections', { identity: identities[1], requestId: randomUUID(), input: { ...input, id: 'selection-target', productionId: null } });
  assert.equal(unattached.status, 200, await unattached.clone().text());
  const after = await (await memoryApi(selectionStatistic.id)).json(); assert.equal(after.uses.selected, before.uses.selected + 2, 'an unattached selection ID never collides with a production ID');
  assert.equal((await query(contexts[1], { materialId: selectionStatistic.materialId })).items[0].uses.selected, after.uses.selected);
  assert.equal(after.uses.inserted, 0); assert.equal(after.uses.approved, 0); assert.equal(after.uses.published, 0);
  await owner("UPDATE public.reporter_ed_productions SET doc=doc||$2::jsonb WHERE portal_id=$1 AND production_id='selection-target'", [PILOT,
    JSON.stringify({ ownerId: contexts[0].actor, restrictedTo: [] })]);
  assert.equal((await memoryApi(`selections/${first.id}`, { identity: identities[1] })).status, 404);
  assert.equal((await memoryApi(`selections/${first.id}`, { identity: identities[0] })).status, 200);
  assert.equal((await (await memoryApi(selectionStatistic.id)).json()).uses.selected, before.uses.selected + 1);
});

test('the SQL selection writer cannot fabricate an applicable review or check revision', async () => {
  const unreviewed = (await read(contexts[1], 'evidence', 'selection-unreviewed'))!;
  const document = { id: 'selection-sql-bypass', workspaceId: PILOT, revision: 1, productionId: null,
    items: [{ evidence: memoryEvidenceRef(unreviewed.doc as unknown as MemoryCitation), check: null, decisionId: null, policyRevision: 1 }] };
  await assert.rejects(session(contexts[1], client => client.query('SELECT public.reporter_memory_selection_save($1::jsonb)',
    [JSON.stringify({ kind: 'selection', id: document.id, expected: null, doc: document })])), conflict);
  const wrongCheck = { ...document, items: [{ ...document.items[0], evidence: memoryEvidenceRef(selectionStatistic), check: { id: selectionStatistic.id, revision: 99 } }] };
  await assert.rejects(session(contexts[1], client => client.query('SELECT public.reporter_memory_selection_save($1::jsonb)',
    [JSON.stringify({ kind: 'selection', id: document.id, expected: null, doc: wrongCheck })])), conflict);
  assert.equal(await read(contexts[1], 'selection', document.id), null);
  await assert.rejects(session(contexts[1], client => client.query('SELECT core.reporter_memory_bundle($1,$2,$3)',
    [PILOT, selectionStatistic.id, 1])), denied, 'the internal bounded reader is unavailable to runtime credentials');
});
