import 'server-only';
import { citationView } from '../domain/citation-library.ts';
import { recheck } from '../domain/fact-check.ts';
import type { EditorialCheckpoint } from '../ports/connected-workspace.ts';
import { transaction } from './database.ts';
import { editorialTransaction } from './editorial';
import { FlowError, logEvent, safeCode } from './errors';
import { factCheckProviders } from './fact-check';
import { runFactCheck } from './fact-check-pipeline.ts';

const LEASE_MS = 60000, MAX_ATTEMPTS = 3;
/** Missing key, refused key, no credits: retrying only spends the run's attempts. */
const TERMINAL = new Set(['TAVILY_KEY_MISSING', 'TAVILY_AUTH_INVALID', 'TAVILY_QUOTA_EXHAUSTED']);

/**
 * Durable, lower-priority work on a completed run: the citations its article produced are
 * fact-checked one after the other. A citation already checked (by a person or another article)
 * is skipped; each result is saved as it settles, so a retry resumes where it stopped.
 */
export async function runFactCheckJob(owner: string, signal: AbortSignal): Promise<boolean> {
  const claim = await transaction('worker', async client => (await client.query('SELECT public.reporter_ed_fact_check_claim($1,$2) AS claim',
    [owner, LEASE_MS])).rows[0].claim as { runId: string; productionId: string; fence: string } | null);
  if (!claim) return false;
  const scope = { productions: [claim.productionId], runs: [claim.runId], items: { citation: 'all' as const, fact_check: 'all' as const } };
  const controller = new AbortController(), combined = AbortSignal.any([signal, controller.signal]);
  const guarded = async <T>(change: (checkpoint: EditorialCheckpoint) => Promise<T>) => (await editorialTransaction('worker', async checkpoint => {
    const current = checkpoint.jobs[claim.runId];
    if (!current?.lease || current.lease.fence !== claim.fence || current.lease.until < Date.now() || current.factCheck?.status !== 'queued')
      throw new FlowError('LEASE_LOST', 409);
    return change(checkpoint);
  }, true, 'reporter.edit', scope)).value;
  let renewing = false;
  const timer = setInterval(() => {
    if (renewing) return; renewing = true;
    void transaction('worker', async client => (await client.query('SELECT public.reporter_ed_fact_check_renew($1,$2,$3,$4) AS renewed',
      [claim.runId, owner, claim.fence, LEASE_MS])).rows[0].renewed === true)
      .then(renewed => { if (!renewed) controller.abort(); }).catch(() => controller.abort()).finally(() => { renewing = false; });
  }, 15000);
  try {
    for (;;) {
      // The next citation still to check, with what the model needs; undefined when all are settled.
      const next = await guarded(async checkpoint => {
        const job = checkpoint.jobs[claim.runId], task = job.factCheck!;
        if (task.attempts > MAX_ATTEMPTS) throw new FlowError('RETRY_EXHAUSTED', 409);
        while (task.done < task.citationIds.length) {
          const id = task.citationIds[task.done];
          const citation = checkpoint.citations?.find(item => item.id === id);
          const source = citation && checkpoint.state.sources.find(item => item.id === citation.ref.sourceId);
          if (citation && source?.rights.authorized && !checkpoint.factChecks?.some(item => item.id === id)) {
            const view = citationView(citation, source, checkpoint.state.people);
            return { id, model: job.pipeline?.definition.steps.quotes.model, subject: { id, text: citation.text, speaker: view.speaker,
              ...(citation.recordedOn ? { recordedOn: citation.recordedOn } : {}), ...(citation.relevance.trim() ? { context: citation.relevance.trim() } : {}) } };
          }
          task.done += 1;
        }
        task.status = 'completed'; delete job.lease;
        return undefined;
      });
      if (!next) break;
      if (!next.model) throw new FlowError('PIPELINE_SNAPSHOT_MISSING', 422);
      const result = await runFactCheck(next.subject, factCheckProviders(next.model), AbortSignal.any([combined, AbortSignal.timeout(150000)]));
      combined.throwIfAborted();
      await guarded(async checkpoint => {
        const saved = checkpoint.factChecks ?? [];
        checkpoint.factChecks = [...saved.filter(item => item.id !== next.id), recheck(saved.find(item => item.id === next.id), result)];
        checkpoint.jobs[claim.runId].factCheck!.done += 1;
      });
    }
    logEvent('worker', 'fact_check_completed', { generation_id: claim.runId });
  } catch (error) {
    const code = safeCode(error);
    try {
      await guarded(async checkpoint => {
        const job = checkpoint.jobs[claim.runId], task = job.factCheck!;
        const retry = !TERMINAL.has(code) && task.attempts < MAX_ATTEMPTS && (signal.aborted || error instanceof FlowError && error.retryable);
        task.status = retry ? 'queued' : 'failed'; task.error = code; delete job.lease;
        if (retry) job.availableAt = Date.now() + Math.max(5000, error instanceof FlowError ? error.waitSeconds * 1000 : 5000);
      });
    } catch { /* An expired or replaced lease cannot commit even a failure. */ }
    logEvent('worker', 'fact_check_failed', { generation_id: claim.runId, error_code: code });
  } finally { clearInterval(timer); }
  return true;
}
