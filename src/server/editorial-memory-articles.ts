import 'server-only';
import type { PoolClient } from 'pg';
import type { ArticleBody } from '../domain/article.ts';
import { articleHash } from '../domain/article.ts';
import type { MemoryArticleOrigin, MemoryCitation, MemoryEvidenceView } from '../domain/editorial-memory.ts';
import type { MemoryArticlePosition, MemoryArticleReport, MemoryLegacyCandidate } from '../domain/editorial-memory-legacy.ts';
import { articleCitations, articleEvidenceId } from '../domain/editorial-memory-legacy.ts';
import type { Piece, Version } from '../domain/piece.ts';
import type { FactCheck } from '../domain/fact-check.ts';
import type { Source } from '../domain/source.ts';
import type { EditorialChanges } from '../ports/editorial-rows.ts';
import { contentHash } from '../domain/text/hash.ts';
import { memoryArticleBatchSchema, memoryIdSchema, memoryLegacyResolutionSchema } from './editorial-memory-input.ts';
import { memoryBundle, memoryReadState } from './editorial-memory-detail.ts';
import { memoryView } from './editorial-memory-query.ts';
import { memoryCommand, memoryGet, memoryRead } from './editorial-memory-store.ts';
import { reconcileMemoryCandidate } from './editorial-memory-legacy.ts';
import { currentWorkerContext } from './worker-context.ts';
import { FlowError } from './errors.ts';

type Entry = Pick<MemoryArticleOrigin, 'productionId' | 'kind' | 'id' | 'storageHash'> & { doc: Piece | Version };
type Resolution = Parameters<typeof memoryLegacyResolutionSchema.parse>[0];
async function sources(client: PoolClient, origin: MemoryArticleOrigin): Promise<Source[]> {
  return (await client.query('SELECT public.reporter_memory_article_sources($1::jsonb) AS value', [JSON.stringify(origin)])).rows[0].value;
}
async function context(client: PoolClient, candidate: MemoryLegacyCandidate): Promise<{ curated: MemoryLegacyCandidate | null; factCheck: FactCheck | null }> {
  return (await client.query('SELECT public.reporter_memory_article_context($1::jsonb,$2::jsonb) AS value', [JSON.stringify(candidate.article), JSON.stringify(candidate.citation)])).rows[0].value;
}
async function observeArticle(client: PoolClient, entry: Entry): Promise<{ origin: MemoryArticleOrigin; quotes: ReturnType<typeof articleCitations> } | 'invalid_metadata' | 'invalid_body'> {
  const body = entry.kind === 'piece' ? (entry.doc as Piece).draft.body : (entry.doc as Version).body;
  const at = entry.kind === 'piece' ? (entry.doc as Piece).draft.updatedAt : (entry.doc as Version).createdAt;
  if (!at || !Number.isFinite(Date.parse(at))) return 'invalid_metadata';
  if (body.type !== 'article' || entry.kind === 'version' && (entry.doc as Version).hash !== articleHash(body as ArticleBody)) return 'invalid_body';
  const origin: MemoryArticleOrigin = { productionId: entry.productionId, kind: entry.kind, id: entry.id, storageHash: entry.storageHash, bodyHash: articleHash(body), at };
  await client.query('SELECT public.reporter_memory_article_snapshot($1::jsonb)', [JSON.stringify(origin)]);
  return { origin, quotes: articleCitations(body, await sources(client, origin), origin) };
}
async function reconcileArticleCandidate(client: PoolClient, candidate: MemoryLegacyCandidate) {
  const original = await context(client, candidate), selected = original.curated ?? { ...candidate, factCheck: original.factCheck };
  const id = original.curated ? selected.citation.id : articleEvidenceId(selected.citation.id, candidate.citation.productionId, selected.citation.ref);
  return { id, legacyId: selected.citation.id, state: await reconcileMemoryCandidate(client, selected) };
}
export async function reconcileMemoryArticles(value: { after?: MemoryArticlePosition | null; limit?: number }, requestId: string): Promise<MemoryArticleReport> {
  const input = memoryArticleBatchSchema.parse(value), observed = await memoryRead(memoryReadState);
  return memoryCommand('memory.articles.reconcile', { input, visibility: observed.visibility }, requestId, 'library.edit', async client => {
    if ((await memoryReadState(client)).visibility !== observed.visibility) throw new FlowError('MEMORY_CURSOR_INVALID', 409);
  }, async client => {
    let after = input.after, totalArticles = 0, scannedArticles = 0; const items: MemoryArticleReport['items'] = [];
    while (items.length < input.limit && scannedArticles < 5) {
      const batch = (await client.query('SELECT public.reporter_memory_articles_batch($1::jsonb,2) AS value', [after ? JSON.stringify(after) : null])).rows[0].value as { items: Entry[]; total: number };
      totalArticles = batch.total; const entry = batch.items[0];
      if (after?.offset && (!entry || entry.id !== after.id || entry.kind !== after.kind || entry.productionId !== after.productionId || entry.storageHash !== after.storageHash))
        throw new FlowError('MEMORY_CONFLICT', 409);
      if (!entry) return { items, nextAfter: null, totalArticles, scannedArticles };
      const completed = { productionId: entry.productionId, kind: entry.kind, id: entry.id, offset: 0, storageHash: null };
      const identity = { articleId: entry.id, productionId: entry.productionId, articleKind: entry.kind };
      scannedArticles++;
      const observed = await observeArticle(client, entry);
      if (typeof observed === 'string') {
        items.push({ ...identity, id: null, legacyId: null, state: observed }); after = completed;
      } else {
        const { origin, quotes } = observed; let offset = after?.offset ?? 0;
        if (offset > quotes.length) throw new FlowError('MEMORY_CONFLICT', 409);
        while (offset < quotes.length && items.length < input.limit) {
          const candidate = quotes[offset++];
          if (candidate === 'ambiguous') { items.push({ ...identity, id: null, legacyId: null, state: 'ambiguous' }); continue; }
          if (!candidate) { items.push({ ...identity, id: null, legacyId: null, state: 'unmatched' }); continue; }
          items.push({ ...identity, ...await reconcileArticleCandidate(client, candidate) });
        }
        if (offset < quotes.length) return { items, nextAfter: { ...completed, offset, storageHash: origin.storageHash }, totalArticles, scannedArticles };
        after = completed;
      }
      if (batch.items.length === 1) return { items, nextAfter: null, totalArticles, scannedArticles };
    }
    return { items, nextAfter: after, totalArticles, scannedArticles };
  });
}
/** Same transaction and authenticated actor as the editorial write; never starts a nested transaction. */
export async function syncMemoryArticles(client: PoolClient, changes: EditorialChanges): Promise<void> {
  const parts = changes.parts.filter(part => !part.deleted && ['piece', 'version'].includes(part.kind));
  const sourceIds = [...new Set(changes.sources.map(source => source.id))];
  const checks = [...new Set(changes.items.filter(item => !item.deleted && item.kind === 'fact_check').map(item => item.id))];
  if (process.env.REPORTER_MEMORY_MODE !== 'on' || !parts.length && !sourceIds.length && !checks.length || currentWorkerContext() && !currentWorkerContext()!.actor) return;
  await client.query("SELECT public.reporter_memory_authorize('library.edit')");
  for (const part of parts) {
    const entry = (await client.query('SELECT public.reporter_memory_article_entry($1,$2,$3) AS value', [part.productionId, part.kind, part.id])).rows[0].value as Entry | null;
    if (!entry) continue;
    const observed = await observeArticle(client, entry);
    if (typeof observed !== 'string') for (const candidate of observed.quotes) if (candidate && candidate !== 'ambiguous') await reconcileArticleCandidate(client, candidate);
  }
  // Refresh only saved variants, even after their live draft no longer contains the quote.
  for (let from = 0; from < Math.max(sourceIds.length, checks.length); from += 100) {
    let after: string | null = null;
    do {
      const page = (await client.query('SELECT public.reporter_memory_article_refresh($1,$2::text[],$3::text[]) AS value',
        [after, sourceIds.slice(from, from + 100), checks.slice(from, from + 100)])).rows[0].value as {
          items: { id: string; origin: MemoryArticleOrigin; ref: MemoryLegacyCandidate['citation']['ref'] }[]; nextAfter: string | null };
      for (const item of page.items) {
        const saved = (await client.query('SELECT public.reporter_memory_article_get($1::jsonb) AS value', [JSON.stringify(item.origin)])).rows[0].value;
        if (!saved) continue;
        const candidate = articleCitations(saved.doc.draft?.body ?? saved.doc.body, await sources(client, item.origin), item.origin)
          .find(value => value && value !== 'ambiguous' && articleEvidenceId(value.citation.id, item.origin.productionId, value.citation.ref) === item.id
            && contentHash(value.citation.ref) === contentHash(item.ref));
        if (candidate && candidate !== 'ambiguous') await reconcileMemoryCandidate(client, { ...candidate, factCheck: (await context(client, candidate)).factCheck });
      }
      after = page.nextAfter;
    } while (after);
  }
}
export async function readMemoryArticle(id: string, snapshot?: string): Promise<{ origin: MemoryArticleOrigin; doc: Piece | Version; importedBy: string; importedAt: string }> {
  memoryIdSchema.parse(id);
  if (snapshot !== undefined && !/^[a-f0-9]{32}$/.test(snapshot)) throw new FlowError('INVALID_INPUT', 422);
  return memoryRead(async client => {
    const saved = (await client.query('SELECT public.reporter_memory_article_evidence($1,$2) AS value', [id, snapshot ?? null])).rows[0].value;
    if (!saved) throw new FlowError('NOT_FOUND', 404);
    return { origin: saved.origin, doc: saved.doc, importedBy: saved.imported_by, importedAt: saved.imported_at };
  });
}
export async function lookupMemoryLegacy(id: string): Promise<{ id: string; materialId: string }[]> {
  memoryIdSchema.parse(id);
  return memoryRead(async client => (await client.query('SELECT public.reporter_memory_legacy_lookup($1) AS value', [id])).rows[0].value);
}
export async function resolveMemoryArticle(id: string, value: Resolution, requestId: string): Promise<MemoryEvidenceView> {
  memoryIdSchema.parse(id); const input = memoryLegacyResolutionSchema.parse(value);
  let candidate: MemoryLegacyCandidate;
  return memoryCommand('memory.article.resolve', { id, input }, requestId, 'library.edit', async client => {
    const evidence = (await memoryGet<MemoryCitation>(client, 'evidence', id))?.doc, origin = evidence?.legacy?.article;
    if (!origin) throw new FlowError('NOT_FOUND', 404);
    const saved = (await client.query('SELECT public.reporter_memory_article_get($1::jsonb) AS value', [JSON.stringify(origin)])).rows[0].value;
    if (!saved) throw new FlowError('NOT_FOUND', 404);
    const body = saved.doc.draft?.body ?? saved.doc.body;
    const found = articleCitations(body, await sources(client, origin), origin).find(item => item && item !== 'ambiguous' && articleEvidenceId(item.citation.id, item.citation.productionId, item.citation.ref) === id);
    if (!found || found === 'ambiguous') throw new FlowError('MEMORY_LEGACY_CONFLICT', 409);
    candidate = { ...found, factCheck: (await context(client, found)).factCheck };
  }, async client => {
    if (await reconcileMemoryCandidate(client, candidate, input) !== 'updated') throw new FlowError('MEMORY_LEGACY_CONFLICT', 409);
    return memoryView(await memoryBundle(client, id, await memoryReadState(client)));
  });
}
