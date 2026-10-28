import 'server-only';
import { memoryArticleBatchSchema, memoryCorrectionSchema, memoryDecisionInputSchema, memoryDuplicateResolutionSchema, memoryHistoryKindSchema, memoryLegacyBatchSchema, memoryLegacyResolutionSchema, memorySelectionInputSchema, parseMemoryHistoryQuery, parseMemoryQuery } from './editorial-memory-input.ts';
import { queryEditorialMemory, readMemoryPolicy } from './editorial-memory-query.ts';
import { readMemoryDetail, readMemoryHistory } from './editorial-memory-detail.ts';
import { reviewEditorialMemory } from './editorial-memory-review.ts';
import { correctEditorialMemory } from './editorial-memory-correction.ts';
import { reconcileEditorialMemory, resolveMemoryLegacy } from './editorial-memory-legacy.ts';
import { lookupMemoryLegacy, readMemoryArticle, reconcileMemoryArticles, resolveMemoryArticle } from './editorial-memory-articles.ts';
import { FlowError } from './errors.ts';
import { resolveMemoryDuplicate } from './editorial-memory-duplicates.ts';
import { readMemorySelection, selectEditorialMemory } from './editorial-memory-selection.ts';

/** The module stays unavailable until its controlled acceptance enables the server ceiling. */
export async function handleEditorialMemory(request: Request, path: string[], readJson: (request: Request) => Promise<unknown>): Promise<Response> {
  if (process.env.REPORTER_MEMORY_MODE !== 'on') throw new FlowError('NOT_FOUND', 404);
  if (request.method === 'GET' && path.length === 0) return Response.json(await queryEditorialMemory(parseMemoryQuery(new URL(request.url).searchParams)),
    { headers: { 'Cache-Control': 'private, no-store' } });
  if (request.method === 'GET' && path.join('/') === 'policy') return Response.json(await readMemoryPolicy(), { headers: { 'Cache-Control': 'private, no-store' } });
  if (request.method === 'GET' && path.length === 1) return Response.json(await readMemoryDetail(path[0]), { headers: { 'Cache-Control': 'private, no-store' } });
  if (request.method === 'GET' && path.length === 2 && path[0] === 'legacy') return Response.json(await lookupMemoryLegacy(path[1]), { headers: { 'Cache-Control': 'private, no-store' } });
  if (request.method === 'GET' && path.length === 2 && path[0] === 'selections') {
    if (new URL(request.url).search) throw new FlowError('INVALID_INPUT', 422);
    return Response.json(await readMemorySelection(path[1]), { headers: { 'Cache-Control': 'private, no-store' } });
  }
  if (request.method === 'POST' && path.join('/') === 'selections') return Response.json(
    await selectEditorialMemory(memorySelectionInputSchema.parse(await readJson(request)), request.headers.get('idempotency-key') ?? ''),
    { headers: { 'Cache-Control': 'private, no-store' } });
  if (request.method === 'GET' && path.length === 2 && path[1] === 'article') {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => key !== 'snapshot') || params.getAll('snapshot').length > 1) throw new FlowError('INVALID_INPUT', 422);
    return Response.json(await readMemoryArticle(path[0], params.get('snapshot') ?? undefined), { headers: { 'Cache-Control': 'private, no-store' } });
  }
  if (request.method === 'GET' && path.length === 3 && path[1] === 'history') return Response.json(
    await readMemoryHistory(path[0], memoryHistoryKindSchema.parse(path[2]), parseMemoryHistoryQuery(new URL(request.url).searchParams)),
    { headers: { 'Cache-Control': 'private, no-store' } });
  if (request.method === 'POST' && path.length === 2 && path[1] === 'review') return Response.json(
    await reviewEditorialMemory(path[0], memoryDecisionInputSchema.parse(await readJson(request)), request.headers.get('idempotency-key') ?? ''),
    { headers: { 'Cache-Control': 'private, no-store' } });
  if (request.method === 'POST' && path.length === 2 && path[1] === 'correction') return Response.json(
    await correctEditorialMemory(path[0], memoryCorrectionSchema.parse(await readJson(request)), request.headers.get('idempotency-key') ?? ''),
    { headers: { 'Cache-Control': 'private, no-store' } });
  if (request.method === 'POST' && path.length === 2 && path[1] === 'duplicate') return Response.json(
    await resolveMemoryDuplicate(path[0], memoryDuplicateResolutionSchema.parse(await readJson(request)), request.headers.get('idempotency-key') ?? ''),
    { headers: { 'Cache-Control': 'private, no-store' } });
  if (request.method === 'POST' && path.join('/') === 'reconcile') return Response.json(
    await reconcileEditorialMemory(memoryLegacyBatchSchema.parse(await readJson(request)), request.headers.get('idempotency-key') ?? ''),
    { headers: { 'Cache-Control': 'private, no-store' } });
  if (request.method === 'POST' && path.length === 2 && path[1] === 'legacy') return Response.json(
    await (path[0].startsWith('article-') ? resolveMemoryArticle : resolveMemoryLegacy)(path[0], memoryLegacyResolutionSchema.parse(await readJson(request)), request.headers.get('idempotency-key') ?? ''),
    { headers: { 'Cache-Control': 'private, no-store' } });
  if (request.method === 'POST' && path.join('/') === 'reconcile/articles') return Response.json(
    await reconcileMemoryArticles(memoryArticleBatchSchema.parse(await readJson(request)), request.headers.get('idempotency-key') ?? ''),
    { headers: { 'Cache-Control': 'private, no-store' } });
  throw new FlowError('NOT_FOUND', 404);
}
