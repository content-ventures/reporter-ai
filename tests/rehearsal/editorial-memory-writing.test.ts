import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg, { type Client, type Pool } from 'pg';
import { startRehearsalDatabase } from '../support/rehearsal-db.ts';
import { createTranscriptSource, toSourceVersionRef } from '../../src/domain/source.ts';
import { parseTranscript } from '../../src/domain/text/transcript-parse.ts';
import { memoryEvidenceRef, type MemoryEvidence, type MemoryMaterial, type MemoryPage, type MemorySelection } from '../../src/domain/editorial-memory.ts';
import type { MemoryDetail, MemoryWritingResult } from '../../src/ports/editorial-memory.ts';
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
async function session<T>(action: (client: Client) => Promise<T>) {
  const client = new pg.Client({ connectionString: db.runtime }); await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.module_key','reporter_ai',true),set_config('app.access_mode','user',true),set_config('app.tenant_id',$1,true),set_config('app.portal_id',$2,true),set_config('app.user_id',$3,true),set_config('app.request_id',$4,true)", [context.tenant, context.portal, context.actor, randomUUID()]);
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

test('download preparation validates actual approval, exact versions and current bank review without recording publication', async () => {
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
  assert.ok(sent.ok, JSON.stringify(sent)); const subject = sent.value.version.ref, input = { productionId: created.productionId, selection: [subject] };
  const before = await json<{ ok: boolean; refusal: { code: string } }>('exports/prepare', input); assert.equal(before.ok, false); assert.equal(before.refusal.code, 'not_approved');
  const approvedResponse = await api('workspace', { method: 'decide', args: [{ pieceId: created.pieceId, subject, displayedHash: subject.hash, decision: 'approved' }], requestId: randomUUID() }, randomUUID(), identities[1]);
  assert.equal(approvedResponse.status, 200, await approvedResponse.clone().text()); const approved = await approvedResponse.json(); assert.ok(approved.ok, JSON.stringify(approved));
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
