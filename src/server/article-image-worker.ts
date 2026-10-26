import 'server-only';
import { logWorkerEvent as logEvent } from './worker-context.ts';
import { withWorkspaceWork } from './worker-dispatch.ts';
import { bindEditorialJob } from './worker-job-context.ts';
import type { ArticleBody } from '../domain/article.ts';
import { PIPELINE_SCHEMAS } from '../domain/pipeline.ts';
import type { PipelineCall } from '../domain/pipeline.ts';
import { createVersion, draftFromVersion } from '../domain/rules/versions.ts';
import { contentHash } from '../domain/text/hash.ts';
import type { EditorialJob } from '../ports/connected-workspace.ts';
import { articleImageTargetMatches } from './article-image-task.ts';
import { illustrateArticle } from './article-illustration.ts';
import { transaction } from './database.ts';
import { appendEditorialEvent, editorialContextHash, editorialTransaction } from './editorial';
import { planArticleImages } from './editorial-images';
import { FlowError, safeCode } from './errors';
import { executePipelineStep } from './pipeline-runner';
import { workDirectory } from './storage';

const LEASE_MS = 60000;
type Dependencies = { plan: typeof executePipelineStep; illustrate: typeof illustrateArticle };
const defaults: Dependencies = { plan: executePipelineStep,illustrate: illustrateArticle };

/** Durable, lower-priority work on a completed run. No text event is replayed or rewritten. */
export async function runArticleImageJob(owner: string,signal: AbortSignal,dependencies: Dependencies = defaults): Promise<boolean> {
  return withWorkspaceWork('images',owner,signal, scoped => runScoped(owner, scoped, dependencies));
}

async function runScoped(owner: string,signal: AbortSignal,dependencies: Dependencies = defaults): Promise<boolean> {
  const claim = await transaction('worker',async client => (await client.query('SELECT public.reporter_ed_image_claim($1,$2) AS claim',
    [owner,LEASE_MS])).rows[0].claim as { runId: string; productionId: string; fence: string } | null);
  if (!claim) return false;
  const scope = { productions: [claim.productionId],runs: [claim.runId] };
  const controller = new AbortController(), combined = AbortSignal.any([signal,controller.signal]);
  const guarded = async <T>(change: Parameters<typeof editorialTransaction<T>>[1]) => editorialTransaction('worker',async (checkpoint,engine,client,loaded) => {
    const current = checkpoint.jobs[claim.runId];
    if (!current?.lease || current.lease.fence !== claim.fence || current.lease.until < Date.now()
      || current.images?.status !== 'queued' || engine.store.state.runFolds[claim.runId]?.run.status !== 'completed')
      throw new FlowError('LEASE_LOST',409);
    return change(checkpoint,engine,client,loaded);
  },true,'reporter.edit',scope);
  const eligible = (engine: Parameters<Parameters<typeof editorialTransaction>[1]>[1],job: EditorialJob) => {
    const record = engine.records.record(claim.productionId);
    return record && record.sources.every(source => source.rights.authorized)
      && (!job.contextHash || editorialContextHash(record,job.meta.pieceId,engine.store.state.runFolds[claim.runId].run.inputs) === job.contextHash)
      ? record : undefined;
  };
  let renewing = false;
  const timer = setInterval(() => {
    if (renewing) return; renewing = true;
    void transaction('worker',async client => (await client.query('SELECT public.reporter_ed_image_renew($1,$2,$3,$4) AS renewed',
      [claim.runId,owner,claim.fence,LEASE_MS])).rows[0].renewed === true)
      .then(renewed => { if (!renewed) controller.abort(); }).catch(() => controller.abort()).finally(() => { renewing = false; });
  },15000);
  try {
    const input = (await guarded(async (checkpoint,engine) => {
      const job = checkpoint.jobs[claim.runId], record = eligible(engine,job);
      bindEditorialJob(job,engine.store.state.runFolds[claim.runId].run.createdBy);
      if (!record || !articleImageTargetMatches(record,job.meta.pieceId,job.images!) || job.images!.attempts > 3) {
        const exhausted = job.images!.attempts > 3;
        job.images!.status = exhausted ? 'failed' : 'skipped'; delete job.lease;
        if (exhausted) job.images!.error = 'RETRY_EXHAUSTED';
        appendEditorialEvent(engine,job,{ type: 'step.skipped',stepId: 'images' });
        appendEditorialEvent(engine,job,{ type: 'step.progress',stepId: 'images',meta: exhausted
          ? 'Limite de tentativas das imagens atingido; o artigo está disponível.' : 'Imagens automáticas encerradas; a edição atual foi preservada.' });
        return undefined;
      }
      const body = record.pieces.find(piece => piece.id === job.meta.pieceId)!.draft.body as ArticleBody;
      appendEditorialEvent(engine,job,{ type: 'step.started',stepId: 'images',meta: 'Gerando imagens em segundo plano' });
      return { job: structuredClone(job),body,identity: { portal: record.production.workspaceId,
        actor: engine.store.state.runFolds[claim.runId].run.createdBy } };
    })).value;
    if (!input) return true;
    const { job,body,identity } = input;
    if (!job.pipeline) throw new FlowError('PIPELINE_SNAPSHOT_MISSING',422);
    const trace = async (call: PipelineCall) => {
      await guarded(async checkpoint => {
        const current = checkpoint.jobs[claim.runId]; current.calls ??= [];
        const index = current.calls.findIndex(previous => previous.hash === call.hash);
        if (index < 0) current.calls.push(call); else current.calls[index] = call;
      });
    };
    const response = await dependencies.plan({ pipeline: job.pipeline,key: 'images',schema: PIPELINE_SCHEMAS.images,
      variables: { history: JSON.stringify(body),source: '',brief: '',sizing: '',outline: '',section: '',futureSections: '',layouts: '',approvedArticle: '', event: '', people: '' },
      directory: await workDirectory(claim.runId),signal: AbortSignal.any([combined,AbortSignal.timeout(30000)]),trace,
      validateOutput: value => { try { planArticleImages(body,value); return true; } catch { return false; } } });
    const planned = { ...body,...planArticleImages(body,response.value) };
    if (body.cover) delete planned.coverSlot;
    // Recheck before spending image requests if an editor changed the draft during planning.
    const stillCurrent = (await guarded(async (checkpoint,engine) => {
      const current = checkpoint.jobs[claim.runId], record = eligible(engine,current);
      const usage = engine.store.state.runFolds[claim.runId].run.usage;
      if (typeof usage?.inputTokens === 'number' && typeof usage.outputTokens === 'number'
        && response.input_units !== null && response.output_units !== null) {
        const inputTokens = usage.inputTokens+response.input_units,outputTokens = usage.outputTokens+response.output_units;
        appendEditorialEvent(engine,current,{ type: 'usage',usage: { inputTokens,outputTokens,totalTokens: inputTokens+outputTokens } });
      }
      return Boolean(record && articleImageTargetMatches(record,current.meta.pieceId,current.images!));
    })).value;
    if (!stillCurrent) throw new FlowError('IMAGE_TARGET_CHANGED',409);
    const result = await dependencies.illustrate(planned,claim.productionId,
      AbortSignal.any([combined,AbortSignal.timeout(170000)]),undefined,identity);
    combined.throwIfAborted();
    await guarded(async (checkpoint,engine) => {
      const current = checkpoint.jobs[claim.runId],record = eligible(engine,current);
      // Keep completed assets available in this production when text was edited while they
      // were generated. An obsolete result never replaces a draft or an immutable version.
      if (record) checkpoint.imageAssets = [...(checkpoint.imageAssets ?? []),...result.assets];
      const matches = Boolean(record && articleImageTargetMatches(record,current.meta.pieceId,current.images!));
      if (matches && contentHash(result.body) !== current.images!.hash) {
        const applied = engine.records.apply(claim.productionId,(record,context) => {
          const piece = record.pieces.find(piece => piece.id === current.meta.pieceId)!;
          const ctx = { ...context,actorId: identity.actor };
          const version = createVersion({ piece,versions: record.versions,body: result.body,origin: 'generation',runId: claim.runId },ctx);
          return { ...record,versions: [...record.versions,version],pieces: record.pieces.map(candidate => candidate.id === piece.id
            ? draftFromVersion(piece,version,ctx) : candidate) };
        },{ persist: 'none' });
        if (!applied.ok) throw new FlowError('IMAGE_TARGET_CHANGED',409);
      }
      current.images!.status = matches ? 'completed' : 'skipped'; delete current.lease;
      appendEditorialEvent(engine,current,{ type: 'step.completed',stepId: 'images',meta: matches
        ? result.filled ? `${result.filled} ${result.filled === 1 ? 'imagem gerada' : 'imagens geradas'} com IA` : 'Sugestões de imagem mantidas'
        : record ? 'Edição preservada; imagens disponíveis na produção.' : 'Imagens encerradas após mudança na fonte; o artigo foi preservado.' });
    });
    logEvent('worker','article_images_completed',{ generation_id: claim.runId });
  } catch (error) {
    const code = safeCode(error);
    try {
      await guarded(async (checkpoint,engine) => {
        const job = checkpoint.jobs[claim.runId];
        const retry = job.images!.attempts < 3 && (signal.aborted || error instanceof FlowError && error.retryable);
        job.images!.status = retry ? 'queued' : code === 'IMAGE_TARGET_CHANGED' ? 'skipped' : 'failed';
        job.images!.error = code; delete job.lease;
        if (retry) job.availableAt = Date.now()+Math.max(5000,error instanceof FlowError ? error.waitSeconds*1000 : 5000);
        appendEditorialEvent(engine,job,{ type: 'step.skipped',stepId: 'images' });
        appendEditorialEvent(engine,job,{ type: 'step.progress',stepId: 'images',meta: retry
          ? 'Imagens aguardando nova tentativa; o artigo está disponível.' : 'Imagens automáticas encerradas; o artigo foi preservado.' });
      });
    } catch { /* An expired or replaced lease cannot commit even a failure. */ }
    logEvent('worker','article_images_failed',{ generation_id: claim.runId,error_code: code });
  } finally { clearInterval(timer); }
  return true;
}
