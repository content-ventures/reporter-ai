import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg, { type Client, type Pool } from 'pg';
import { startRehearsalDatabase } from '../support/rehearsal-db.ts';
import { createTranscriptSource, toSourceVersionRef } from '../../src/domain/source.ts';
import { parseTranscript } from '../../src/domain/text/transcript-parse.ts';
import { memoryEvidenceRef, type MemoryEvidence, type MemoryMaterial, type MemoryPage, type MemorySelection } from '../../src/domain/editorial-memory.ts';
import type { MemoryDetail, MemoryWritingResult, MemoryWritingStatus } from '../../src/ports/editorial-memory.ts';
import type { ReporterRequestContext } from '../../src/server/request-context.ts';
import type { ArticleBody } from '../../src/domain/article.ts';
import type { VersionRef } from '../../src/domain/refs.ts';
import type { Piece } from '../../src/domain/piece.ts';
import { paragraphBlock, quoteBlock } from '../../src/domain/article.ts';
import { segmentRef } from '../../src/domain/refs.ts';
import { r1ArticleIssue } from '../../src/domain/article-policy.ts';
import type { RequestedReview } from '../../src/ports/production-commands.ts';

const PORTAL = '10000000-0000-0000-0000-000000000101', APP = 'http://127.0.0.1:3994';
const identities = ['editor', 'approver', 'editor'].map((role, index) => ({ subject: `writing-${index}`, email: `${index}@writing.test`, name: role, emailVerified: true }));
let db: Awaited<ReturnType<typeof startRehearsalDatabase>>, context: ReporterRequestContext;
async function owner(sql: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: db.owner }); await client.connect();
  try { return (await client.query(sql, values)).rows; } finally { await client.end(); }
}
async function session<T>(action: (client: Client) => Promise<T>, acting: ReporterRequestContext = context) {
  const client = new pg.Client({ connectionString: db.runtime }); await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.module_key','reporter_ai',true),set_config('app.access_mode','user',true),set_config('app.tenant_id',$1,true),set_config('app.portal_id',$2,true),set_config('app.user_id',$3,true),set_config('app.request_id',$4,true)", [acting.tenant, acting.portal, acting.actor, randomUUID()]);
    const result = await action(client); await client.query('COMMIT'); return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { await client.end(); }
}
async function api(path: string, input?: unknown, key: string = randomUUID(), identity: typeof identities[number] | null = identities[0], origin = APP) {
  const { handleReporter } = await import('../../src/server/http.ts'), url = new URL(`${APP}/api/reporter/w/reporter-ai/${path}`);
  return handleReporter(new Request(url, input === undefined ? {} : { method: 'POST', headers: { origin, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(input) }),
    ['w', 'reporter-ai', ...url.pathname.split('/').slice(5).filter(Boolean)], { identify: async () => identity });
}
async function json<T>(path: string, input?: unknown, key?: string): Promise<T> {
  const response = await api(path, input, key); assert.equal(response.status, 200, await response.clone().text()); return response.json() as Promise<T>;
}
const writingInput = { baseRevision: 1, title: 'Synthetic writing collection', brief: { size: 'standard' as const, sections: 3 } };
before(async () => {
  db = await startRehearsalDatabase(identities.map((identity, index) => ({ email: identity.email, role: index === 1 ? 'approver' : 'editor' })));
  for (const identity of identities) await owner('UPDATE core.users SET auth_subject=$2,email_verified=true WHERE email=$1', [identity.email, identity.subject]);
  Object.assign(process.env, { REPORTER_DEPLOYMENT_MODE: 'cloud', REPORTER_DATABASE_URL: db.runtime, REPORTER_WORKER_DATABASE_URL: db.worker,
    REPORTER_DEFAULT_PORTAL_ID: PORTAL, REPORTER_WORKSPACES_MODE: 'all', REPORTER_APP_ORIGINS: APP, REPORTER_MEMORY_MODE: 'on', REPORTER_WORKER_PASSWORD: db.workerPassword });
  context = (await (await import('../../src/server/database.ts')).resolveReporterContext(identities[0], 'reporter-ai'))!;
  await owner("INSERT INTO public.reporter_ed_items(portal_id,kind,item_id,doc,seq) VALUES($1,'person',$2,$3,1)", [PORTAL, 'synthetic-author', JSON.stringify({ id: 'synthetic-author', name: 'Ana Sintética', title: 'Pesquisadora', organization: 'Instituto Fictício' })]);
}, { timeout: 300000 });
after(async () => {
  const pools = (globalThis as typeof globalThis & { reporterPools?: Partial<Record<string, Pool>> }).reporterPools ?? {};
  await Promise.all(Object.values(pools).map(pool => pool?.end())); db?.stop();
});
async function fixture(kind: 'citation' | 'statistic', privateOrigin = false) {
  const id = randomUUID(), excerpt = kind === 'citation' ? 'Uma declaração sintética literal com 🐟 e autoria conhecida.' : 'Foram atendidas cerca de 240 pessoas fictícias em 2025.';
  const source = createTranscriptSource({ workspaceId: PORTAL, title: 'Synthetic original', origin: 'other', authorized: true,
    parsed: parseTranscript(`${excerpt}\n\nCONTEÚDO PRIVADO FORA DA SELEÇÃO`, { format: 'plain' }) }, { actorId: context.actor, now: new Date().toISOString(), newId: () => `original-${id}` });
  await owner('INSERT INTO public.reporter_ed_sources(portal_id,source_id,doc,seq) VALUES($1,$2,$3,1)', [PORTAL, source.id, JSON.stringify(source)]);
  let productionId: string | null = null;
  if (privateOrigin) {
    const created = await json<{ ok: true; value: { productionId: string } }>('workspace', { method: 'createBlank', args: [{ title: 'Private synthetic original', brief: writingInput.brief }], requestId: randomUUID() });
    assert.equal(created.ok, true); productionId = created.value.productionId;
    await owner("UPDATE public.reporter_ed_productions SET doc=doc||jsonb_build_object('sourceIds',$3::jsonb,'restrictedTo','[]'::jsonb),source_ids=$4 WHERE portal_id=$1 AND production_id=$2",
      [PORTAL, productionId, JSON.stringify([source.id]), [source.id]]);
  }
  const metadata = { publishedOn: null, recordedOn: null, institution: null, company: null, event: null, edition: null, topics: [], originalUrl: null };
  const material: MemoryMaterial = { id: `material-${id}`, workspaceId: PORTAL, revision: 1, title: 'Synthetic material', kind: 'report', source: toSourceVersionRef(source), metadata,
    importedAt: source.createdAt, importedBy: context.actor, primaryOrigin: id, originalFileId: null };
  const base = { id, workspaceId: PORTAL, materialId: material.id, revision: 0, kinds: ['declared' as const], metadata, status: 'active' as const,
    createdAt: source.createdAt, updatedAt: source.createdAt, supersedes: null,
    anchor: { source: material.source, spans: [{ segmentId: source.versions[0].content.segments[0].id, from: 0, to: excerpt.length }], excerpt } };
  const evidence: MemoryEvidence = kind === 'citation' ? { ...base, kind, text: excerpt, personId: 'synthetic-author', authorConfirmed: true, legacyCitationId: null }
    : { ...base, kind, indicator: 'Atendimento', value: { raw: '240', decimal: '240', lower: null, upper: null, scale: null }, unit: 'pessoas', period: { label: '2025', from: null, to: null },
      geography: null, population: null, qualifier: 'cerca de', issuingInstitution: null, declaringPersonId: null };
  await session(async client => {
    await client.query('SELECT public.reporter_memory_put($1::jsonb)', [JSON.stringify({ kind: 'material', id: material.id, expected: null, doc: material, sourceId: source.id, productionId })]);
    await client.query('SELECT public.reporter_memory_put($1::jsonb)', [JSON.stringify({ kind: 'evidence', id, expected: null, doc: evidence, fingerprint: memoryEvidenceRef(evidence).hash, parentKind: 'material', parentId: material.id })]);
  });
  await json(`memory/${id}/review`, { evidence: memoryEvidenceRef(evidence), check: null, policyRevision: 1, previousSequence: 0, action: 'accept', reason: 'Checked synthetic original.', supports: [] });
  return { evidence, material, source };
}
const selection = (evidence: MemoryEvidence[]) => json<MemorySelection>('memory/selections', { productionId: null, baseRevision: 0, evidence: evidence.map(memoryEvidenceRef) });
async function gateRecord(productionId: string) {
  const { runWithReporterContext } = await import('../../src/server/request-context.ts'), { editorialTransaction } = await import('../../src/server/editorial.ts');
  const { guardMemoryArticle, guardMemorySources } = await import('../../src/server/editorial-memory-operation.ts');
  return (await runWithReporterContext(context, () => editorialTransaction('runtime', async (_checkpoint, engine, client) => {
    const record = engine.records.record(productionId)!;
    const sources = await guardMemorySources(client, record), body = record.pieces[0].draft.body;
    assert.equal(body.type, 'article');
    return { sources, article: await guardMemoryArticle(client, body as ArticleBody, record.sources) };
  }, false, 'reporter.edit', { productions: [productionId], pipelines: false }))).value;
}

test('writing creates one ordered multi-material article, literal sources and actual inserted uses atomically', async () => {
  const quote = await fixture('citation'), statistic = await fixture('statistic'), saved = await selection([statistic.evidence, quote.evidence]), key = randomUUID();
  const result = await json<MemoryWritingResult>(`memory/selections/${saved.id}/write`, writingInput, key);
  assert.deepEqual(await json(`memory/selections/${saved.id}/write`, writingInput, key), result);
  const [row] = await owner('SELECT doc FROM public.reporter_ed_sources WHERE source_id=$1', [result.sourceId]);
  assert.deepEqual(row.doc.versions[0].content.segments.map((item: { text: string }) => item.text), [statistic.evidence.anchor.excerpt, quote.evidence.anchor.excerpt]);
  assert.equal(JSON.stringify(row.doc).includes('CONTEÚDO PRIVADO'), false); assert.deepEqual(row.doc.memory[0].items.map((item: { selected: unknown }) => item.selected), saved.items);
  assert.deepEqual(row.doc.speakers, [{ label: 'memory-person-synthetic-author', personId: 'synthetic-author' }]);
  for (const evidence of [statistic.evidence, quote.evidence]) {
    const detail = await json<MemoryDetail>(`memory/${evidence.id}`); assert.equal(detail.uses.inserted, 1); assert.equal(detail.uses.approved, 0); assert.equal(detail.uses.published, 0);
    const uses = detail.occurrences.items.filter(item => item.stage === 'inserted'); assert.equal(uses.length, 1);
    assert.equal(uses[0].personId, context.actor); assert.equal(uses[0].sourceRange?.to, evidence.anchor.excerpt.length);
    const [audit] = await owner("SELECT user_id FROM public.audit_log WHERE action='memory.use.inserted' AND after_data->>'id'=$1", [uses[0].id]); assert.equal(audit.user_id, context.actor);
  }
  assert.equal((await api(`memory/selections/${saved.id}/write`, { ...writingInput, title: 'Changed payload' }, key)).status, 409);
  assert.equal((await json<MemorySelection>(`memory/selections/${saved.id}`)).productionId, null);
});
test('writing rejects stale selection revisions, decisions and revoked source rights', async () => {
  for (const mode of ['revision', 'decision', 'rights']) {
    const item = await fixture('statistic'), saved = await selection([item.evidence]);
    if (mode === 'decision') await json(`memory/${item.evidence.id}/review`, { evidence: memoryEvidenceRef(item.evidence), check: null, policyRevision: 1, previousSequence: 1, action: 'reject', reason: 'Synthetic refusal after selection.', supports: [] });
    if (mode === 'rights') await json(`memory/materials/${item.material.id}/authorization`, { baseRevision: 1, authorized: false, reason: 'Synthetic rights withdrawal.' });
    assert.equal((await api(`memory/selections/${saved.id}/write`, { ...writingInput, ...(mode === 'revision' ? { baseRevision: 99 } : {}) })).status, 409);
  }
});
test('writing status reads current gates for every collection without recording a use or exposing originals', async () => {
  const a = await fixture('statistic'), aSelection = await selection([a.evidence]);
  const made = await json<MemoryWritingResult>(`memory/selections/${aSelection.id}/write`, writingInput);
  const b = await fixture('citation'), bSelection = await selection([b.evidence]);
  const [before] = await owner('SELECT doc FROM public.reporter_ed_productions WHERE production_id=$1', [made.productionId]);
  const added = await json<MemoryWritingResult>(`memory/selections/${bSelection.id}/write`, { baseRevision: 1, target: { productionId: made.productionId, updatedAt: before.doc.updatedAt } });
  const path = `memory/productions/${made.productionId}/writing-status`;
  const production = () => owner('SELECT doc,seq FROM public.reporter_ed_productions WHERE production_id=$1', [made.productionId]);
  const uses = () => owner("SELECT doc FROM public.reporter_memory_history WHERE portal_id=$1 AND kind='use' AND doc->>'productionId'=$2 ORDER BY id,storage_revision", [PORTAL, made.productionId]);
  const savedProduction = await production(), savedUses = await uses();
  const response = await api(path); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const initial = await response.json() as MemoryWritingStatus;
  assert.equal(initial.productionId, made.productionId); assert.equal(initial.updatedAt, savedProduction[0].doc.updatedAt);
  assert.ok(Number.isFinite(Date.parse(initial.checkedAt))); assert.deepEqual(initial.issues, []);
  assert.deepEqual(initial.sources.map(ref => ref.sourceId), [made.sourceId, added.sourceId]);
  assert.ok(initial.sources.every(ref => ref.kind === 'source-version' && ref.sourceVersion === 1 && ref.hash));
  assert.equal(JSON.stringify(initial).includes('CONTEÚDO PRIVADO'), false);
  assert.equal((await api(path, undefined, randomUUID(), identities[1])).status, 200, 'approver may read the current status');
  assert.deepEqual(await production(), savedProduction); assert.deepEqual(await uses(), savedUses);
  await json(`memory/${a.evidence.id}/review`, { evidence: memoryEvidenceRef(a.evidence), check: null, policyRevision: 1, previousSequence: 1, action: 'reject', reason: 'Synthetic change after attaching the source.', supports: [] });
  const changed = await json<MemoryWritingStatus>(path);
  assert.equal(changed.issues.length, 1); assert.equal(changed.issues[0].source.sourceId, made.sourceId);
  assert.equal(changed.issues[0].code, 'memory_review_changed'); assert.ok(changed.issues[0].message);
  assert.deepEqual(changed.sources, initial.sources, 'attached immutable snapshots have not been silently refreshed');
  await json(`memory/materials/${b.material.id}/authorization`, { baseRevision: 1, authorized: false, reason: 'Synthetic rights revoked after attachment.' });
  assert.deepEqual((await json<MemoryWritingStatus>(path)).issues.map(issue => issue.source.sourceId), [made.sourceId, added.sourceId]);
  assert.deepEqual(await production(), savedProduction); assert.deepEqual(await uses(), savedUses);
  assert.equal((await api(path + '?unexpected=1')).status, 422);
  assert.equal((await api(path, {})).status, 404);
});
test('writing status preserves private production scope, authentication and the module ceiling', async () => {
  const item = await fixture('statistic', true), saved = await selection([item.evidence]);
  const made = await json<MemoryWritingResult>(`memory/selections/${saved.id}/write`, writingInput);
  const path = `memory/productions/${made.productionId}/writing-status`;
  assert.equal((await api(path)).status, 200);
  assert.equal((await api(path, undefined, randomUUID(), identities[2])).status, 404);
  assert.equal((await api(path, undefined, randomUUID(), null)).status, 401);
  assert.equal((await api('memory/productions/unknown-production/writing-status')).status, 404);
  process.env.REPORTER_MEMORY_MODE = 'off';
  try { assert.equal((await api(path)).status, 404); }
  finally { process.env.REPORTER_MEMORY_MODE = 'on'; }
});
test('creation and receipt replay preserve inherited private scope and actual role boundaries', async () => {
  const item = await fixture('statistic', true), saved = await selection([item.evidence]), key = randomUUID();
  const result = await json<MemoryWritingResult>(`memory/selections/${saved.id}/write`, writingInput, key);
  const [row] = await owner('SELECT doc FROM public.reporter_ed_productions WHERE production_id=$1', [result.productionId]); assert.deepEqual(row.doc.restrictedTo, [context.actor]);
  assert.equal((await api(`memory/selections/${saved.id}/write`, writingInput, key, identities[2])).status, 404);
  assert.equal((await api(`memory/selections/${saved.id}/write`, writingInput, key, identities[1])).status, 403);
  assert.equal((await api(`memory/selections/${saved.id}/write`, writingInput, key, null)).status, 401);
  assert.equal((await api(`memory/selections/${saved.id}/write`, writingInput, key, identities[0], 'https://foreign.invalid')).status, 403);
  for (const extra of [{ personId: context.actor }, { source: item.source }]) assert.equal((await api(`memory/selections/${saved.id}/write`, { ...writingInput, ...extra })).status, 422);
});
test('an insertion audit failure rolls back production, source, uses and idempotency receipt together', async () => {
  const item = await fixture('statistic'), saved = await selection([item.evidence]), key = randomUUID();
  const count = async () => (await owner('SELECT (SELECT count(*) FROM public.reporter_ed_productions)::int AS productions,(SELECT count(*) FROM public.reporter_ed_sources)::int AS sources'))[0], before = await count();
  await owner("CREATE FUNCTION core.fail_writing_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='memory.use.inserted' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_writing_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION core.fail_writing_audit()");
  try { assert.equal((await api(`memory/selections/${saved.id}/write`, writingInput, key)).status, 500); } finally { await owner('DROP TRIGGER fail_writing_audit ON public.audit_log; DROP FUNCTION core.fail_writing_audit()'); }
  assert.deepEqual(await count(), before); assert.equal((await json<MemoryDetail>(`memory/${item.evidence.id}`)).uses.inserted, 0);
  const result = await json<MemoryWritingResult>(`memory/selections/${saved.id}/write`, writingInput, key); assert.ok(result.productionId);
});
test('saved selections recover ordered snapshots with private scopes and actor-bound stable pages', async () => {
  const item = await fixture('statistic'), first = await selection([item.evidence]), second = await selection([item.evidence]);
  const page = await json<MemoryPage<MemorySelection>>('memory/selections?limit=1'); assert.equal(page.items[0].id, second.id); assert.ok(page.nextCursor);
  const late = await selection([item.evidence]);
  const next = await json<MemoryPage<MemorySelection>>(`memory/selections?limit=1&cursor=${encodeURIComponent(page.nextCursor!)}`);
  assert.equal(next.items[0].id, first.id); assert.equal(next.total, page.total); assert.equal(next.snapshot, page.snapshot); assert.notEqual(next.items[0].id, late.id);
  assert.equal((await api(`memory/selections?limit=1&cursor=${encodeURIComponent(page.nextCursor!)}`, undefined, randomUUID(), identities[2])).status, 409);
  assert.equal((await api(`memory/selections?limit=2&cursor=${encodeURIComponent(page.nextCursor!)}`)).status, 409);
  assert.equal((await api('memory/selections?createdBy=forged')).status, 422);
  const privateItem = await fixture('statistic', true), privateSelection = await selection([privateItem.evidence]);
  const visible = await json<MemoryPage<MemorySelection>>('memory/selections?limit=100'); assert.ok(visible.items.some(item => item.id === privateSelection.id));
  const other = await (await api('memory/selections?limit=100', undefined, randomUUID(), identities[2])).json() as MemoryPage<MemorySelection>;
  assert.equal(other.items.some(item => item.id === privateSelection.id), false);
});
test('existing-pauta attachment preserves draft, brief, frozen versions and old sources without inventing an insertion', async () => {
  const original = await fixture('statistic'), initial = await selection([original.evidence]);
  const created = await json<MemoryWritingResult>(`memory/selections/${initial.id}/write`, writingInput);
  const frozen = await json<{ ok: true; value: { version: { ref: VersionRef } } }>('workspace', { method: 'createVersion', args: [created.pieceId], requestId: randomUUID() });
  assert.equal(frozen.ok, true);
  const [beforeProduction] = await owner('SELECT doc FROM public.reporter_ed_productions WHERE production_id=$1', [created.productionId]);
  const [beforePiece] = await owner("SELECT doc FROM public.reporter_ed_parts WHERE kind='piece' AND part_id=$1", [created.pieceId]);
  const [beforeVersion] = await owner("SELECT doc FROM public.reporter_ed_parts WHERE kind='version' AND part_id=$1", [frozen.value.version.ref.versionId]);
  const quote = await fixture('citation'), saved = await json<MemorySelection>('memory/selections', { baseRevision: 0, productionId: created.productionId, evidence: [memoryEvidenceRef(quote.evidence)] });
  const input = { baseRevision: saved.revision, target: { productionId: created.productionId, updatedAt: beforeProduction.doc.updatedAt } }, key = randomUUID();
  assert.equal((await api(`memory/selections/${saved.id}/write`, { ...input, target: { ...input.target, productionId: 'another-pauta' } })).status, 409);
  const attached = await json<MemoryWritingResult>(`memory/selections/${saved.id}/write`, input, key);
  assert.equal(attached.productionId, created.productionId); assert.equal(attached.pieceId, created.pieceId); assert.notEqual(attached.sourceId, created.sourceId);
  assert.deepEqual(await json(`memory/selections/${saved.id}/write`, input, key), attached);
  const [after] = await owner('SELECT doc FROM public.reporter_ed_productions WHERE production_id=$1', [created.productionId]);
  assert.deepEqual(after.doc.sourceIds, [created.sourceId, attached.sourceId]); assert.deepEqual(after.doc.brief, beforeProduction.doc.brief); assert.equal(after.doc.title, beforeProduction.doc.title);
  assert.deepEqual((await owner("SELECT doc FROM public.reporter_ed_parts WHERE kind='piece' AND part_id=$1", [created.pieceId]))[0], beforePiece);
  assert.deepEqual((await owner("SELECT doc FROM public.reporter_ed_parts WHERE kind='version' AND part_id=$1", [frozen.value.version.ref.versionId]))[0], beforeVersion);
  const detail = await json<MemoryDetail>(`memory/${quote.evidence.id}`); assert.equal(detail.uses.inserted, 0); assert.equal(detail.uses.approved, 0); assert.equal(detail.uses.published, 0);
  const activities = await owner("SELECT doc FROM public.reporter_ed_items WHERE portal_id=$1 AND kind='activity' AND doc->>'type'='source.added' AND doc->'subject'->>'sourceId'=$2", [PORTAL, attached.sourceId]);
  assert.equal(activities.length, 1); assert.equal(activities[0].doc.actorId, context.actor);
});
test('existing-pauta attachment refuses stale or incompatible destinations and rolls back every effect on a failed audit', async () => {
  const item = await fixture('statistic', true), saved = await selection([item.evidence]);
  const blank = await json<{ ok: true; value: { productionId: string } }>('workspace', { method: 'createBlank', args: [{ title: 'Existing synthetic destination', brief: writingInput.brief }], requestId: randomUUID() });
  assert.equal(blank.ok, true); const productionId = blank.value.productionId;
  const [target] = await owner('SELECT doc FROM public.reporter_ed_productions WHERE production_id=$1', [productionId]);
  const input = { baseRevision: saved.revision, target: { productionId, updatedAt: target.doc.updatedAt } };
  assert.equal((await api(`memory/selections/${saved.id}/write`, input)).status, 409, 'Never broaden private material into a workspace-wide production');
  await owner("UPDATE public.reporter_ed_productions SET doc=doc||jsonb_build_object('restrictedTo','[]'::jsonb) WHERE production_id=$1", [productionId]);
  assert.equal((await api(`memory/selections/${saved.id}/write`, { ...input, target: { ...input.target, updatedAt: '2020-01-01T00:00:00Z' } })).status, 409);
  assert.equal((await api(`memory/selections/${saved.id}/write`, { ...input, target: { ...input.target, personId: context.actor } })).status, 422);
  assert.equal((await api(`memory/selections/${saved.id}/write`, input, randomUUID(), identities[1])).status, 403);
  const counts = async () => (await owner('SELECT (SELECT count(*) FROM public.reporter_ed_sources)::int AS sources,(SELECT count(*) FROM public.reporter_memory_receipts)::int AS receipts'))[0];
  const before = await counts(), key = randomUUID();
  await owner("CREATE FUNCTION core.fail_attachment_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='activity' AND NEW.doc->>'type'='source.added' THEN RAISE EXCEPTION 'synthetic attachment audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_attachment_audit BEFORE INSERT ON public.reporter_ed_items FOR EACH ROW EXECUTE FUNCTION core.fail_attachment_audit()");
  try { assert.equal((await api(`memory/selections/${saved.id}/write`, input, key)).status, 500); }
  finally { await owner('DROP TRIGGER fail_attachment_audit ON public.reporter_ed_items; DROP FUNCTION core.fail_attachment_audit()'); }
  assert.deepEqual(await counts(), before);
  assert.deepEqual((await owner('SELECT doc FROM public.reporter_ed_productions WHERE production_id=$1', [productionId]))[0].doc.sourceIds, []);
  const attached = await json<MemoryWritingResult>(`memory/selections/${saved.id}/write`, input, key); assert.equal(attached.productionId, productionId);
  assert.equal((await api(`memory/selections/${saved.id}/write`, input, key, identities[2])).status, 404);
});
test('concurrent existing-pauta attachments cannot overwrite each other or reuse a stale destination snapshot', async () => {
  const blank = await json<{ ok: true; value: { productionId: string } }>('workspace', { method: 'createBlank', args: [{ title: 'Concurrent synthetic destination', brief: writingInput.brief }], requestId: randomUUID() });
  assert.equal(blank.ok, true); const productionId = blank.value.productionId;
  const [target] = await owner('SELECT doc FROM public.reporter_ed_productions WHERE production_id=$1', [productionId]);
  const first = await fixture('statistic'), second = await fixture('citation'), selections = [await selection([first.evidence]), await selection([second.evidence])];
  const results = await Promise.all(selections.map(saved => api(`memory/selections/${saved.id}/write`, { baseRevision: saved.revision, target: { productionId, updatedAt: target.doc.updatedAt } })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const [stored] = await owner('SELECT doc FROM public.reporter_ed_productions WHERE production_id=$1', [productionId]);
  assert.equal(stored.doc.sourceIds.length, 1);
  for (const item of [first, second]) assert.equal((await json<MemoryDetail>(`memory/${item.evidence.id}`)).uses.inserted, 0);
});
test('sending, approving and recording delivery revalidate the exact bank evidence and preserve frozen article versions', async () => {
  const item = await fixture('statistic'), saved = await selection([item.evidence]);
  const created = await json<MemoryWritingResult>(`memory/selections/${saved.id}/write`, writingInput);
  const current = await gateRecord(created.productionId); assert.equal(current.sources.ok, true); assert.equal(current.article.ok, true);
  const snapshot = await json<{ ok: true; value: { version: { ref: VersionRef } } }>('workspace', { method: 'createVersion', args: [created.pieceId], requestId: randomUUID() });
  assert.ok(snapshot.ok); const subject = snapshot.value.version.ref;
  const [original] = await owner("SELECT doc FROM public.reporter_ed_parts WHERE kind='version' AND part_id=$1", [subject.versionId]);
  await json(`memory/${item.evidence.id}/correction`, { expected: memoryEvidenceRef(item.evidence), reason: 'Synthetic observation metadata changed after writing.', changes: { kind: 'statistic', metadata: { institution: 'Corrected synthetic origin' } } });
  const outdated = await gateRecord(created.productionId); assert.equal(outdated.sources.ok, false); assert.equal(outdated.article.ok, false);
  for (const payload of [{ method: 'requestReview', args: [created.pieceId] }, { method: 'recordDelivery', args: [{ productionId: created.productionId, selection: [subject], files: [{ fileName: 'synthetic-v1.md', format: 'md', versionId: subject.versionId, ok: true }] }] }]) {
    const refused = await json<{ ok: false; refusal: { code: string } }>('workspace', { ...payload, requestId: randomUUID() }); assert.equal(refused.ok, false); assert.equal(refused.refusal.code, 'memory_not_ready');
  }
  const response = await api('workspace', { method: 'decide', args: [{ pieceId: created.pieceId, subject, displayedHash: subject.hash, decision: 'approved' }], requestId: randomUUID() }, randomUUID(), identities[1]);
  assert.equal(response.status, 200, await response.clone().text()); const refused = await response.json(); assert.equal(refused.ok, false); assert.equal(refused.refusal.code, 'memory_not_ready');
  assert.deepEqual((await owner("SELECT doc FROM public.reporter_ed_parts WHERE kind='version' AND part_id=$1", [subject.versionId]))[0], original);
  assert.equal((await owner("SELECT count(*)::int AS n FROM public.reporter_ed_parts WHERE production_id=$1 AND kind IN ('decision','delivery','review')", [created.productionId]))[0].n, 0);
});
test('edited numeric context or withdrawn original rights cannot pass a send gate or inflate use', async () => {
  for (const mode of ['literal', 'rights']) {
    const item = await fixture('statistic'), saved = await selection([item.evidence]);
    const created = await json<MemoryWritingResult>(`memory/selections/${saved.id}/write`, writingInput);
    if (mode === 'rights') await json(`memory/materials/${item.material.id}/authorization`, { baseRevision: 1, authorized: false, reason: 'Synthetic original rights withdrawn after writing.' });
    else {
      const [row] = await owner("SELECT doc FROM public.reporter_ed_parts WHERE kind='piece' AND part_id=$1", [created.pieceId]), piece = row.doc as Piece;
      const body = structuredClone(piece.draft.body) as ArticleBody, block = body.blocks[0]; if (block.type !== 'paragraph') throw new Error('paragraph'); block.inlines[0].text = item.evidence.anchor.excerpt.replace('cerca de ', '');
      const result = await json<{ ok: boolean }>('workspace', { method: 'saveDraft', args: [created.pieceId, body, piece.draft.revision], requestId: randomUUID() }); assert.equal(result.ok, true);
    }
    const refused = await json<{ ok: boolean; refusal: { code: string; message: string } }>('workspace', { method: 'requestReview', args: [created.pieceId], requestId: randomUUID() });
    assert.equal(refused.ok, false); assert.equal(refused.refusal.code, 'memory_not_ready');
    if (mode === 'literal') assert.match(refused.refusal.message, /qualificadores/);
    const detail = await json<MemoryDetail>(`memory/${item.evidence.id}`); assert.equal(detail.uses.inserted, 1); assert.equal(detail.uses.approved, 0); assert.equal(detail.uses.published, 0);
  }
});

async function sentBankArticle() {
  const item = await fixture('citation'), saved = await selection([item.evidence]);
  const created = await json<MemoryWritingResult>(`memory/selections/${saved.id}/write`, writingInput);
  const [sourceRow] = await owner('SELECT doc FROM public.reporter_ed_sources WHERE source_id=$1', [created.sourceId]);
  const original = item.evidence.anchor.excerpt, fragment = original.slice(0, original.indexOf(' com '));
  const body: ArticleBody = { type: 'article', title: 'Synthetic complete export acceptance', blocks: [
    quoteBlock('full-bank-quote', original, { sourceRefs: [segmentRef(created.sourceId, 1, 'memory-item-1', { from: 0, to: original.length })] }),
    paragraphBlock('synthetic-body', 'Este material de teste descreve apenas um cenário sintético sem qualquer aplicação factual no mundo real. '.repeat(32)),
    quoteBlock('bank-fragment', fragment, { sourceRefs: [segmentRef(created.sourceId, 1, 'memory-item-1', { from: 0, to: fragment.length })] }),
  ] };
  assert.equal(r1ArticleIssue(body, [sourceRow.doc]), undefined, 'the positive acceptance must satisfy the actual article contract');
  const [pieceRow] = await owner("SELECT doc FROM public.reporter_ed_parts WHERE kind='piece' AND part_id=$1", [created.pieceId]);
  const updated = await json<{ ok: boolean }>('workspace', { method: 'saveDraft', args: [created.pieceId, body, pieceRow.doc.draft.revision], requestId: randomUUID() }); assert.equal(updated.ok, true);
  const sent = await json<{ ok: true; value: RequestedReview }>('workspace', { method: 'requestReview', args: [created.pieceId], requestId: randomUUID() });
  assert.ok(sent.ok, JSON.stringify(sent)); const subject = sent.value.version.ref;
  return { item, saved, created, subject, body };
}

test('download preparation validates actual approval, exact versions and current bank review without recording publication', async () => {
  const { item, saved, created, subject } = await sentBankArticle(), input = { productionId: created.productionId, selection: [subject] };
  const before = await json<{ ok: boolean; refusal: { code: string } }>('exports/prepare', input); assert.equal(before.ok, false); assert.equal(before.refusal.code, 'not_approved');
  const approvalInput = { method: 'decide', args: [{ pieceId: created.pieceId, subject, displayedHash: subject.hash, decision: 'approved' }], requestId: randomUUID() };
  const approvedResponse = await api('workspace', approvalInput, randomUUID(), identities[1]);
  assert.equal(approvedResponse.status, 200, await approvedResponse.clone().text()); const approved = await approvedResponse.json(); assert.ok(approved.ok, JSON.stringify(approved));
  assert.notEqual(approved.value.by, context.actor, 'the real article approver differs from its sender');
  const used = await json<MemoryDetail>(`memory/${item.evidence.id}`), approvedUses = used.occurrences.items.filter(item => item.stage === 'approved');
  assert.equal(approvedUses.length, 2); assert.equal(used.uses.approved, 1, 'two actual ranges count one distinct approved article');
  for (const use of approvedUses) {
    assert.equal(use.stage, 'approved'); if (use.stage !== 'approved') throw new Error('approved use');
    assert.deepEqual(use.article, subject); assert.equal(use.productionTitle, writingInput.title); assert.equal(use.decisionId, approved.value.id); assert.equal(use.personId, approved.value.by); assert.equal(use.at, approved.value.at);
    assert.deepEqual(use.proof?.selected, saved.items[0]); assert.deepEqual(use.proof?.anchor, item.evidence.anchor);
  }
  const replay = await api('workspace', approvalInput, randomUUID(), identities[1]); assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), approved);
  assert.equal((await json<MemoryDetail>(`memory/${item.evidence.id}`)).occurrences.items.filter(item => item.stage === 'approved').length, 2);
  const audits = await owner("SELECT user_id,after_data FROM public.audit_log WHERE action='memory.use.approved' AND after_data->>'productionId'=$1", [created.productionId]);
  assert.equal(audits.length, 2); assert.ok(audits.every(row => row.user_id === approved.value.by && row.after_data.article.hash === subject.hash));
  const receipt = { productionId: created.productionId, decisionId: approved.value.id, article: subject, blockId: 'full-bank-quote', from: 0, to: item.evidence.anchor.excerpt.length,
    source: { id: created.sourceId, version: 1, segmentId: 'memory-item-1', from: 0, to: item.evidence.anchor.excerpt.length } };
  const { resolveReporterContext } = await import('../../src/server/database.ts'), approver = (await resolveReporterContext(identities[1], 'reporter-ai'))!;
  const derive = (value: unknown) => session(async client => { await client.query("SELECT set_config('app.editorial_permission','reporter.review',true)");
    return (await client.query('SELECT public.reporter_memory_record_approval($1::jsonb) AS value', [JSON.stringify(value)])).rows[0].value; }, approver);
  assert.deepEqual(await derive(receipt), approvedUses.find(use => use.blockId === 'full-bank-quote'));
  for (const forged of [{ ...receipt, article: { ...subject, number: subject.number + 1 } }, { ...receipt, decisionId: randomUUID() }, { ...receipt, from: 1 }])
    await assert.rejects(derive(forged), (error: unknown) => (error as Error).message === 'MEMORY_CONFLICT');
  await assert.rejects(derive({ ...receipt, personId: context.actor }), (error: unknown) => (error as { code: string }).code === '22023');
  await assert.rejects(session(client => client.query('SELECT public.reporter_memory_record_approval($1::jsonb)', [JSON.stringify(receipt)])),
    (error: unknown) => (error as { code: string }).code === '42501');
  const ready = await json<{ ok: boolean; value: VersionRef[] }>('exports/prepare', input); assert.ok(ready.ok); assert.deepEqual(ready.value, [subject]);
  const forged = await json<{ ok: boolean; refusal: { code: string } }>('exports/prepare', { ...input, selection: [{ ...subject, number: subject.number + 1 }] });
  assert.equal(forged.ok, false); assert.equal(forged.refusal.code, 'unknown_version');
  assert.equal((await api('exports/prepare', { ...input, actor: 'forged' })).status, 422);
  assert.equal((await api('exports/prepare', input, randomUUID(), identities[1])).status, 403);
  assert.equal((await api('exports/prepare', input, randomUUID(), null)).status, 401);
  await json(`memory/${item.evidence.id}/review`, { evidence: memoryEvidenceRef(item.evidence), check: null, policyRevision: 1, previousSequence: 1,
    action: 'accept', reason: 'New synthetic review after preparing the approved article.', supports: [] });
  const stale = await json<{ ok: boolean; refusal: { code: string } }>('exports/prepare', input); assert.equal(stale.ok, false); assert.equal(stale.refusal.code, 'memory_not_ready');
  assert.equal((await json<MemoryDetail>(`memory/${item.evidence.id}`)).uses.published, 0);
  assert.equal((await owner("SELECT count(*)::int AS n FROM public.reporter_ed_parts WHERE production_id=$1 AND kind='delivery'", [created.productionId]))[0].n, 0);
});


test('an approved-use audit failure rolls the actual article decision and every occurrence back together', async () => {
  const { item, created, subject } = await sentBankArticle();
  const approval = { method: 'decide', args: [{ pieceId: created.pieceId, subject, displayedHash: subject.hash, decision: 'approved' }], requestId: randomUUID() };
  await owner(`CREATE FUNCTION public.fail_approved_use_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action='memory.use.approved' THEN RAISE EXCEPTION 'synthetic approval audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_approved_use_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.fail_approved_use_audit()`);
  try { assert.equal((await api('workspace', approval, randomUUID(), identities[1])).status, 500); }
  finally { await owner('DROP TRIGGER fail_approved_use_audit ON public.audit_log; DROP FUNCTION public.fail_approved_use_audit()'); }
  assert.equal((await owner("SELECT count(*)::int AS n FROM public.reporter_ed_parts WHERE production_id=$1 AND kind='decision'", [created.productionId]))[0].n, 0);
  assert.equal((await json<MemoryDetail>(`memory/${item.evidence.id}`)).uses.approved, 0);
  const retried = await api('workspace', approval, randomUUID(), identities[1]); assert.equal(retried.status, 200); const result = await retried.json(); assert.ok(result.ok, JSON.stringify(result));
  const after = await json<MemoryDetail>(`memory/${item.evidence.id}`); assert.equal(after.uses.approved, 1); assert.equal(after.uses.published, 0);
  assert.equal(after.occurrences.items.filter(item => item.stage === 'approved').length, 2);
});
