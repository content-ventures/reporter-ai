import 'server-only';
import { createMemoryBatch, readMemoryBatch, readMemoryBatchCandidate, readMemoryBatches, updateMemoryBatchItem, uploadMemoryBatchItem, processMemoryBatchItem } from './editorial-memory-batches.ts';
import { memoryArticleBatchSchema, memoryAuthorizationSchema, memoryCancelSchema, memoryCheckInputSchema, memoryCorrectionSchema, memoryDecisionInputSchema, memoryDuplicateResolutionSchema, memoryHistoryKindSchema, memoryImportInputSchema, memoryLegacyBatchSchema, memoryLegacyResolutionSchema, memoryRetrySchema, memorySelectionInputSchema, memoryWritingInputSchema, parseMemoryHistoryQuery, parseMemoryQuery } from './editorial-memory-input.ts';
import { queryEditorialMemory, readMemoryPolicy } from './editorial-memory-query.ts';
import { readMemoryDetail, readMemoryHistory } from './editorial-memory-detail.ts';
import { readMemoryDocumentLocation } from './editorial-memory-document-location.ts';
import { readMemoryCorrectionImpact } from './editorial-memory-impact.ts';
import { readMemoryReplacement, replaceEditorialMemory } from './editorial-memory-replacement.ts';
import { memoryReplacementSchema } from './editorial-memory-input.ts';
import { memoryRelevanceSchema, parseMemoryFeedbackQuery, parseMemoryRelevanceContext } from './editorial-memory-input.ts';
import { readMemoryFeedback, readMemoryRelevanceContext, recordMemoryRelevance } from './editorial-memory-feedback.ts';
import { activateEditorialMemoryPolicy, annotateMemoryCalibration, proposeEditorialMemoryPolicy, readMemoryPolicyProposal, readMemoryPolicyRecords } from './editorial-memory-policies.ts';
import { memoryCalibrationCaseSchema, memoryPolicyActivationSchema, memoryPolicyProposalSchema, memoryPolicyRestoreSchema } from './editorial-memory-input.ts';
import { reviewEditorialMemory } from './editorial-memory-review.ts';
import { correctEditorialMemory } from './editorial-memory-correction.ts';
import { reviseEditorialMemoryMaterial } from './editorial-memory-material-revision.ts';
import { memoryMaterialRevisionSchema } from './editorial-memory-input.ts';
import { reconcileEditorialMemory, resolveMemoryLegacy } from './editorial-memory-legacy.ts';
import { lookupMemoryLegacy, readMemoryArticle, reconcileMemoryArticles, resolveMemoryArticle } from './editorial-memory-articles.ts';
import { FlowError } from './errors.ts';
import { downloadMemoryOriginal, importMemoryOriginal, readMemoryOriginal, uploadMemoryOriginal } from './editorial-memory-original-files.ts';
import { resolveMemoryDuplicate } from './editorial-memory-duplicates.ts';
import { checkEditorialMemory } from './editorial-memory-check.ts';
import { reassessEditorialMemory } from './editorial-memory-reassessment.ts';
import { memoryPolicyReassessmentSchema } from './editorial-memory-input.ts';
import { writeMemorySelection } from './editorial-memory-writing.ts';
import { readMemoryWritingStatus } from './editorial-memory-writing-status.ts';
import { readMemorySelectedContext } from './editorial-memory-selected-context.ts';
import { refreshEditorialMemorySource } from './editorial-memory-refresh.ts';
import { memorySourceRefreshSchema } from './editorial-memory-input.ts';
import { readMemorySelection, readMemorySelections, selectEditorialMemory } from './editorial-memory-selection.ts';
import { actMemoryJob, authorizeMemoryMaterial, importEditorialMemory, readMemoryBlocks, readMemoryJob, readMemoryMaterial, readMemoryMaterials } from './editorial-memory-materials.ts';

/** The module stays unavailable until its controlled acceptance enables the server ceiling. */
export async function handleEditorialMemory(request: Request, path: string[], readJson: (request: Request) => Promise<unknown>): Promise<Response> {
  if (process.env.REPORTER_MEMORY_MODE !== 'on') throw new FlowError('NOT_FOUND', 404);
  const noStore = { headers: { 'Cache-Control': 'private, no-store' } }, params = new URL(request.url).searchParams;
  if (path[0] === 'batches') {
    if (request.method === 'GET' && path.length === 1) return Response.json(await readMemoryBatches(parseMemoryHistoryQuery(params)), noStore);
    if ([...params].length) throw new FlowError('INVALID_INPUT', 422);
    if (request.method === 'GET' && path.length === 2) return Response.json(await readMemoryBatch(path[1]), noStore);
    if (request.method === 'GET' && path.length === 5 && path[2] === 'items' && path[4] === 'candidate') return Response.json(await readMemoryBatchCandidate(path[1], path[3]), noStore);
    if (request.method === 'POST') {
      const key = request.headers.get('idempotency-key') ?? '';
      if (path.length === 1) return Response.json(await createMemoryBatch(await readJson(request), key), noStore);
      if (path.length === 5 && path[2] === 'items') {
        const value = await readJson(request);
        if (path[4] === 'upload') return Response.json(await uploadMemoryBatchItem(path[1], path[3], value, key), noStore);
        if (path[4] === 'process') return Response.json(await processMemoryBatchItem(path[1], path[3], value, key), noStore);
        if (path[4] === 'revision') return Response.json(await updateMemoryBatchItem(path[1], path[3], value, key), noStore);
      }
    }
    throw new FlowError('NOT_FOUND', 404);
  }
  if (path[0] === 'originals' || path.join('/') === 'materials/from-file') {
    if ([...params].length) throw new FlowError('INVALID_INPUT', 422);
    if (request.method === 'GET' && path[0] === 'originals' && path.length === 2) return Response.json(await readMemoryOriginal(path[1]), noStore);
    if (request.method === 'GET' && path[0] === 'originals' && path.length === 3 && path[2] === 'file') return downloadMemoryOriginal(path[1]);
    if (request.method === 'POST' && path.length === 1) return Response.json(await uploadMemoryOriginal(await readJson(request), request.headers.get('idempotency-key') ?? ''), noStore);
    if (request.method === 'POST' && path.join('/') === 'materials/from-file') return Response.json(await importMemoryOriginal(await readJson(request), request.headers.get('idempotency-key') ?? ''), noStore);
    throw new FlowError('NOT_FOUND', 404);
  }
  if (path[0] === 'policy' && path.length > 1) {
    if (request.method === 'GET' && path.length === 2 && ['cases', 'proposals', 'versions'].includes(path[1])) return Response.json(
      await readMemoryPolicyRecords(path[1] === 'cases' ? 'case' : path[1] === 'proposals' ? 'proposal' : 'version', parseMemoryHistoryQuery(params)), noStore);
    if ([...params].length) throw new FlowError('INVALID_INPUT', 422);
    if (request.method === 'GET' && path.length === 3 && path[1] === 'proposals') return Response.json(await readMemoryPolicyProposal(path[2]), noStore);
    if (request.method === 'POST') {
      const key = request.headers.get('idempotency-key') ?? '';
      if (path.length === 2 && path[1] === 'cases') return Response.json(await annotateMemoryCalibration(memoryCalibrationCaseSchema.parse(await readJson(request)), key), noStore);
      if (path.length === 2 && path[1] === 'proposals') return Response.json(await proposeEditorialMemoryPolicy(memoryPolicyProposalSchema.parse(await readJson(request)), key), noStore);
      if (path.length === 2 && path[1] === 'restore') return Response.json(await proposeEditorialMemoryPolicy(memoryPolicyRestoreSchema.parse(await readJson(request)), key, true), noStore);
      if (path.length === 4 && path[1] === 'proposals' && path[3] === 'activate') return Response.json(await activateEditorialMemoryPolicy(path[2], memoryPolicyActivationSchema.parse(await readJson(request)), key), noStore);
    }
    throw new FlowError('NOT_FOUND', 404);
  }
  if (request.method === 'GET' && path.join('/') === 'feedback') return Response.json(await readMemoryFeedback(parseMemoryFeedbackQuery(params)), noStore);
  if (request.method === 'GET' && path.join('/') === 'feedback/relevance-context') return Response.json(await readMemoryRelevanceContext(parseMemoryRelevanceContext(params)), noStore);
  if (request.method === 'POST' && path.join('/') === 'feedback/relevance') {
    if ([...params].length) throw new FlowError('INVALID_INPUT', 422);
    return Response.json(await recordMemoryRelevance(memoryRelevanceSchema.parse(await readJson(request)), request.headers.get('idempotency-key') ?? ''), noStore);
  }
  if (request.method === 'GET' && path.length === 2 && path[0] === 'replacements') {
    if ([...params].length) throw new FlowError('INVALID_INPUT', 422);
    return Response.json(await readMemoryReplacement(path[1]), noStore);
  }
  if (request.method === 'GET' && path.length === 2 && path[1] === 'original-location') {
    if ([...params.keys()].some(key => !['revision', 'hash'].includes(key)) || params.getAll('revision').length !== 1
      || params.getAll('hash').length !== 1 || !/^(0|[1-9]\d{0,8})$/.test(params.get('revision') ?? '') || !/^[a-f0-9]{16}$/.test(params.get('hash') ?? ''))
      throw new FlowError('INVALID_INPUT', 422);
    return Response.json(await readMemoryDocumentLocation({ id: path[0], revision: Number(params.get('revision')), hash: params.get('hash')! }), noStore);
  }
  if (request.method === 'POST' && path.length === 2 && path[1] === 'replacement') {
    if ([...params].length) throw new FlowError('INVALID_INPUT', 422);
    return Response.json(await replaceEditorialMemory(path[0], memoryReplacementSchema.parse(await readJson(request)), request.headers.get('idempotency-key') ?? ''), noStore);
  }
  if (request.method === 'GET' && (path.length === 3 && path[0] === 'materials' && path[2] === 'impact' || path.length === 2 && path[1] === 'impact')) {
    return Response.json(await readMemoryCorrectionImpact({ kind: path.length === 3 ? 'material' : 'evidence', id: path.length === 3 ? path[1] : path[0] }, parseMemoryHistoryQuery(params)), noStore);
  }
  if (request.method === 'GET' && path.length === 5 && path[0] === 'productions' && path[2] === 'sources' && path[4] === 'context') {
    if ([...params.keys()].some(key => !['sourceVersion', 'segmentId'].includes(key)) || params.getAll('sourceVersion').length !== 1
      || params.getAll('segmentId').length !== 1 || !/^[1-9]\d{0,8}$/.test(params.get('sourceVersion') ?? '')) throw new FlowError('INVALID_INPUT', 422);
    return Response.json(await readMemorySelectedContext(path[1], { sourceId: path[3], sourceVersion: Number(params.get('sourceVersion')), segmentId: params.get('segmentId')! }), noStore);
  }
  if (request.method === 'POST' && path.length === 3 && path[0] === 'sources' && path[2] === 'refresh') {
    if ([...params].length) throw new FlowError('INVALID_INPUT', 422);
    return Response.json(await refreshEditorialMemorySource(path[1], memorySourceRefreshSchema.parse(await readJson(request)), request.headers.get('idempotency-key') ?? ''), noStore);
  }
  if (request.method === 'GET' && path.length === 3 && path[0] === 'productions' && path[2] === 'writing-status') {
    if ([...params].length) throw new FlowError('INVALID_INPUT', 422);
    return Response.json(await readMemoryWritingStatus(path[1]), noStore);
  }
  if (path[0] === 'materials' || path[0] === 'jobs') {
    if (request.method === 'GET') {
      if (path[0] === 'materials' && path.length === 1) return Response.json(await readMemoryMaterials(parseMemoryHistoryQuery(params)), noStore);
      if (path[0] === 'jobs' && path.length === 3 && path[2] === 'blocks') return Response.json(await readMemoryBlocks(path[1], parseMemoryHistoryQuery(params)), noStore);
      if (path.length === 2) {
        if (path[0] === 'materials' && params.has('revision')) {
          if ([...params.keys()].some(key => key !== 'revision') || params.getAll('revision').length !== 1 || !/^[1-9]\d{0,8}$/.test(params.get('revision') ?? '')) throw new FlowError('INVALID_INPUT', 422);
          return Response.json(await readMemoryMaterial(path[1], Number(params.get('revision'))), noStore);
        }
        if ([...params].length) throw new FlowError('INVALID_INPUT', 422);
        return Response.json(await (path[0] === 'materials' ? readMemoryMaterial(path[1]) : readMemoryJob(path[1])), noStore);
      }
    }
    if (request.method === 'POST') {
      if ([...params].length) throw new FlowError('INVALID_INPUT', 422);
      const key = request.headers.get('idempotency-key') ?? '';
      if (path[0] === 'materials' && path.length === 3 && path[2] === 'revision') return Response.json(await reviseEditorialMemoryMaterial(path[1], memoryMaterialRevisionSchema.parse(await readJson(request)), key), noStore);
      if (path[0] === 'materials' && path.length === 3 && path[2] === 'authorization') return Response.json(await authorizeMemoryMaterial(path[1], memoryAuthorizationSchema.parse(await readJson(request)), key), noStore);
      if (path[0] === 'materials' && path.length === 1) return Response.json(await importEditorialMemory(memoryImportInputSchema.parse(await readJson(request)), key), noStore);
      if (path[0] === 'jobs' && path.length === 3 && (path[2] === 'retry' || path[2] === 'cancel')) {
        const input = (path[2] === 'cancel' ? memoryCancelSchema : memoryRetrySchema).parse(await readJson(request));
        return Response.json(await actMemoryJob(path[1], path[2], input, key), noStore);
      }
    }
    throw new FlowError('NOT_FOUND', 404);
  }
  if (request.method === 'GET' && path.length === 0) return Response.json(await queryEditorialMemory(parseMemoryQuery(new URL(request.url).searchParams)),
    { headers: { 'Cache-Control': 'private, no-store' } });
  if (request.method === 'GET' && path.join('/') === 'policy') { if ([...params].length) throw new FlowError('INVALID_INPUT', 422); return Response.json(await readMemoryPolicy(), noStore); }
  if (request.method === 'GET' && path.join('/') === 'selections') return Response.json(await readMemorySelections(parseMemoryHistoryQuery(params)), noStore);
  if (request.method === 'GET' && path.length === 1) return Response.json(await readMemoryDetail(path[0]), { headers: { 'Cache-Control': 'private, no-store' } });
  if (request.method === 'GET' && path.length === 2 && path[0] === 'legacy') return Response.json(await lookupMemoryLegacy(path[1]), { headers: { 'Cache-Control': 'private, no-store' } });
  if (request.method === 'GET' && path.length === 2 && path[0] === 'selections') {
    if (new URL(request.url).search) throw new FlowError('INVALID_INPUT', 422);
    return Response.json(await readMemorySelection(path[1]), { headers: { 'Cache-Control': 'private, no-store' } });
  }
  if (request.method === 'POST' && path.length === 3 && path[0] === 'selections' && path[2] === 'write') {
    if ([...params].length) throw new FlowError('INVALID_INPUT', 422);
    return Response.json(await writeMemorySelection(path[1], memoryWritingInputSchema.parse(await readJson(request)), request.headers.get('idempotency-key') ?? ''), noStore);
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
  if (request.method === 'POST' && path.length === 2 && path[1] === 'check') {
    if ([...params].length) throw new FlowError('INVALID_INPUT', 422);
    return Response.json(await checkEditorialMemory(path[0], memoryCheckInputSchema.parse(await readJson(request)).expected, request.headers.get('idempotency-key') ?? ''), noStore);
  }
  if (request.method === 'POST' && path.length === 2 && path[1] === 'reassess-policy') {
    if ([...params].length) throw new FlowError('INVALID_INPUT', 422);
    return Response.json(await reassessEditorialMemory(path[0], memoryPolicyReassessmentSchema.parse(await readJson(request)), request.headers.get('idempotency-key') ?? ''), noStore);
  }
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
