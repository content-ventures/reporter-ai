import 'server-only';
import type { PoolClient } from 'pg';
import type { MemoryCitation, MemoryEvidenceRef, MemoryEvidenceView, MemoryMaterial } from '../domain/editorial-memory.ts';
import { memoryEvidenceRef, sameMemoryEvidence } from '../domain/editorial-memory.ts';
import type { MemoryLegacyCandidate, MemoryLegacyReport, MemoryLegacyState } from '../domain/editorial-memory-legacy.ts';
import { articleCitations, articleEvidenceId, mapLegacyCitation } from '../domain/editorial-memory-legacy.ts';
import type { Source } from '../domain/source.ts';
import { contentHash } from '../domain/text/hash.ts';
import { memoryLegacyBatchSchema, memoryLegacyResolutionSchema, memoryIdSchema } from './editorial-memory-input.ts';
import { memoryBundle, memoryReadState } from './editorial-memory-detail.ts';
import { memoryView } from './editorial-memory-query.ts';
import { memoryCommand, memoryGet, memoryPut, memoryRead } from './editorial-memory-store.ts';
import { currentReporterContext } from './request-context.ts';
import { currentWorkerContext } from './worker-context.ts';
import { FlowError } from './errors.ts';
import { reconcileMemoryDuplicate } from './editorial-memory-duplicates.ts';

type LegacyBatch = { items: MemoryLegacyCandidate[]; total: number; nextAfter: string | null };
type Resolution = { expected: MemoryEvidenceRef; legacyHash: string; choice: 'keep_bank' | 'apply_legacy'; reason: string };
async function candidates(client: PoolClient, after: string | null, limit: number, ids?: string[], sources?: string[]): Promise<LegacyBatch> {
  return (await client.query('SELECT public.reporter_memory_legacy_batch($1,$2,$3::text[],$4::text[]) AS value', [after, limit, ids ?? null, sources ?? null])).rows[0].value;
}
export async function reconcileMemoryCandidate(client: PoolClient, candidate: MemoryLegacyCandidate, resolution?: Resolution): Promise<MemoryLegacyState> {
  const context = currentWorkerContext() ?? currentReporterContext(), now = new Date().toISOString();
  if (!context.actor) throw new FlowError('JOB_CONTEXT_MISMATCH', 422);
  const mapped = mapLegacyCitation(candidate, context.portal, context.actor, now);
  if (typeof mapped === 'string') return mapped;
  const current = await memoryGet<MemoryCitation>(client, 'evidence', mapped.evidence.id);
  if (current && (current.doc.kind !== 'citation' || current.doc.legacyCitationId !== candidate.citation.id
    || current.origin_production_id !== candidate.citation.productionId || current.source_id !== candidate.citation.ref.sourceId
    || current.parent_id !== mapped.material.id)) return 'id_conflict';
  if (current?.doc.deduplication?.state === 'superseded') return 'unchanged';
  if (resolution && (!current || !sameMemoryEvidence(resolution.expected, memoryEvidenceRef(current.doc)))) throw new FlowError('MEMORY_CONFLICT', 409);
  const previous = current?.doc, incomingHash = memoryEvidenceRef(mapped.evidence).hash, previousHash = previous ? memoryEvidenceRef(previous).hash : null;
  if (!resolution && previous?.legacy?.article && candidate.article) {
    const before = previous.legacy.article, next = candidate.article;
    const rank = (value: typeof before) => [Date.parse(value.at), value.kind === 'piece' ? 1 : 0, value.id] as const;
    const a = rank(before), b = rank(next);
    if (a[0] > b[0] || a[0] === b[0] && (a[1] > b[1] || a[1] === b[1] && a[2] > b[2])) {
      const saved = (await client.query('SELECT public.reporter_memory_article_get($1::jsonb) AS value', [JSON.stringify(before)])).rows[0].value;
      const sources = (await client.query('SELECT public.reporter_memory_article_sources($1::jsonb) AS value', [JSON.stringify(before)])).rows[0].value as Source[];
      const found = saved && articleCitations(saved.doc.draft?.body ?? saved.doc.body, sources, before).find(item => item && item !== 'ambiguous' && item.citation.id === candidate.citation.id
        && contentHash(item.citation.ref) === contentHash(previous.legacy!.citation.ref));
      return found && found !== 'ambiguous' ? reconcileMemoryCandidate(client, { ...found, factCheck: candidate.factCheck }) : previous.legacy.state === 'conflict' ? 'conflict' : 'unchanged';
    }
  }
  const hash = contentHash({ citation: candidate.citation, factCheck: candidate.factCheck, mappedHash: incomingHash, article: candidate.article });
  if (resolution && (resolution.legacyHash !== previous?.legacy?.hash || resolution.legacyHash !== hash)) throw new FlowError('MEMORY_CONFLICT', 409);
  const material = await memoryGet<MemoryMaterial>(client, 'material', mapped.material.id);
  if (!material || contentHash({ title: material.doc.title, metadata: material.doc.metadata, primaryOrigin: material.doc.primaryOrigin })
    !== contentHash({ title: mapped.material.title, metadata: mapped.material.metadata, primaryOrigin: mapped.material.primaryOrigin }))
    await memoryPut(client, { kind: 'material', id: mapped.material.id, expected: material?.storage_revision ?? null,
      doc: { ...mapped.material, revision: (material?.doc.revision ?? 0) + 1, importedAt: material?.doc.importedAt ?? mapped.material.importedAt,
        importedBy: material?.doc.importedBy ?? mapped.material.importedBy }, sourceId: candidate.citation.ref.sourceId, productionId: candidate.citation.productionId });
  const consolidate = () => !candidate.article ? reconcileMemoryDuplicate(client,
    articleEvidenceId(candidate.citation.id, candidate.citation.productionId, candidate.citation.ref), candidate.citation.id) : Promise.resolve();
  if (!resolution && previous?.legacy?.hash === hash) { await consolidate(); return previous.legacy.state === 'conflict' ? 'conflict' : 'unchanged'; }
  const baseline = previous?.legacy?.mappedHash, incomingChanged = incomingHash !== baseline;
  const conflict = !resolution && Boolean(previous && (previous.legacy?.state === 'conflict'
    || incomingChanged && previousHash !== baseline && previousHash !== incomingHash));
  const keep = resolution?.choice === 'keep_bank' || !resolution && (conflict || !incomingChanged);
  const chosen = keep && previous ? previous : mapped.evidence;
  const payload = previous?.deduplication ? { ...chosen, deduplication: previous.deduplication } : chosen;
  const semanticChange = previousHash !== memoryEvidenceRef(payload).hash;
  const evidence: MemoryCitation = { ...payload, revision: previous ? previous.revision + (semanticChange || resolution ? 1 : 0) : payload.revision,
    createdAt: previous?.createdAt ?? payload.createdAt, updatedAt: semanticChange || resolution ? now : previous?.updatedAt ?? payload.updatedAt,
    legacy: { citation: candidate.citation, factCheck: candidate.factCheck, hash, mappedHash: incomingHash,
      state: conflict ? 'conflict' : 'synchronized', importedAt: now, importedBy: context.actor,
      reason: resolution?.reason ?? 'Reconciliação da citação antiga.', ...(candidate.article ? { article: candidate.article } : {}),
      ...(resolution ? { resolution: { choice: resolution.choice, reason: resolution.reason } } : {}) } };
  await client.query(`SELECT public.${candidate.article ? 'reporter_memory_article_save' : 'reporter_memory_legacy_save'}($1::jsonb,$2)`, [JSON.stringify({ kind: 'evidence', id: evidence.id,
    expected: current?.storage_revision ?? null, doc: evidence, fingerprint: memoryEvidenceRef(evidence).hash, parentKind: 'material', parentId: mapped.material.id }), evidence.legacy!.reason]);
  await consolidate();
  return conflict ? 'conflict' : current ? 'updated' : 'imported';
}
export async function reconcileEditorialMemory(value: { after?: string | null; limit?: number }, requestId: string): Promise<MemoryLegacyReport> {
  const input = memoryLegacyBatchSchema.parse(value), state = await memoryRead(memoryReadState);
  return memoryCommand('memory.reconcile', { input, visibility: state.visibility }, requestId, 'library.edit', async client => {
    if ((await memoryReadState(client)).visibility !== state.visibility) throw new FlowError('MEMORY_CURSOR_INVALID', 409);
  }, async client => {
    const batch = await candidates(client, input.after, input.limit), items: MemoryLegacyReport['items'] = [];
    for (const candidate of batch.items) items.push({ id: candidate.citation.id, state: await reconcileMemoryCandidate(client, candidate) });
    return { items, total: batch.total, nextAfter: batch.nextAfter };
  });
}
export async function resolveMemoryLegacy(id: string, value: Resolution, requestId: string): Promise<MemoryEvidenceView> {
  memoryIdSchema.parse(id); const input = memoryLegacyResolutionSchema.parse(value);
  return memoryCommand('memory.legacy.resolve', { id, input }, requestId, 'library.edit', async client => {
    await memoryBundle(client, id, await memoryReadState(client));
    if (!(await candidates(client, null, 1, [id])).items.length) throw new FlowError('NOT_FOUND', 404);
  }, async client => {
    const candidate = (await candidates(client, null, 1, [id])).items[0], state = await reconcileMemoryCandidate(client, candidate, input);
    if (!['updated', 'unchanged'].includes(state)) throw new FlowError('MEMORY_LEGACY_CONFLICT', 409);
    return memoryView(await memoryBundle(client, id, await memoryReadState(client)));
  });
}
/** Called inside an existing editorial write transaction, after its rows commit and before COMMIT. */
export async function syncLegacyMemory(client: PoolClient, ids: string[], sources: string[] = []): Promise<void> {
  if (process.env.REPORTER_MEMORY_MODE !== 'on' || !ids.length && !sources.length || currentWorkerContext() && !currentWorkerContext()!.actor) return;
  await client.query("SELECT public.reporter_memory_authorize('library.edit')");
  const unique = [...new Set(ids)];
  for (let from = 0; from < unique.length; from += 100) {
    const batch = await candidates(client, null, 100, unique.slice(from, from + 100));
    for (const candidate of batch.items) await reconcileMemoryCandidate(client, candidate);
  }
  const uniqueSources = [...new Set(sources)];
  for (let from = 0; from < uniqueSources.length; from += 100) {
    let after: string | null = null;
    do {
      const batch = await candidates(client, after, 100, undefined, uniqueSources.slice(from, from + 100));
      for (const candidate of batch.items) await reconcileMemoryCandidate(client, candidate);
      after = batch.nextAfter;
    } while (after);
  }
}
