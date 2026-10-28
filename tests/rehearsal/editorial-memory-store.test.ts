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
      supports: [{ claim: 0, relation: 'confirms', evidence: { kind: 'internal', evidence: memoryEvidenceRef(privateCitation), primaryOrigin: 'private', excerpt: 'Private editorial annotation' } }],
      claims: [], strength: { score: 5, reason: 'Private editorial annotation' }, provider: null, model: null } }));
  assert.equal(await read(contexts[2], 'check', target.id), null);
  assert.ok(await read(contexts[1], 'check', target.id));
  const publicView = await query(contexts[2], { kind: 'statistic' });
  assert.equal(publicView.items.find(item => item.evidence.id === target.id)!.check, null);
  assert.ok(!JSON.stringify(publicView).includes('Private editorial annotation'));
  assert.equal((await query(contexts[2], { kind: 'statistic', minConfidence: 99 })).total, 0);
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
