import 'server-only';
import { citationView } from '../domain/citation-library.ts';
import { recheck } from '../domain/fact-check.ts';
import type { EditorialCheckpoint } from '../ports/connected-workspace.ts';
import { transaction } from './database.ts';
import { editorialTransaction } from './editorial';
import { FlowError, logEvent, safeCode } from './errors';
import { factCheckProviders } from './fact-check';
import { runFactCheck } from './fact-check-pipeline.ts';

const LEASE_MS = 60000, MAX_ATTEMPTS = 3, CITATION_TRIES = 3;
/** A citation is started only with this much of the invocation left: two model calls and three searches. */
const CITATION_BUDGET_MS = 3 * 60 * 1000;
/** Missing key, refused key, no credits: retrying only spends the run's attempts. */
const TERMINAL = new Set(['TAVILY_KEY_MISSING', 'TAVILY_AUTH_INVALID', 'TAVILY_QUOTA_EXHAUSTED', 'UNSUPPORTED_GENERATION_MODEL']);
/** The model provider's own key and credit refusals are as final as Tavily's: skipping each citation would hide them. */
const terminal = (code: string) => TERMINAL.has(code) || /_(?:KEY_MISSING|AUTH_INVALID|QUOTA_EXHAUSTED)$/.test(code);

const pause = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

/**
 * Durable, lower-priority work on a completed run: the citations its article produced are
 * fact-checked one after the other. A citation already checked (by a person or another article)
 * is skipped; each result is saved as it settles, so a retry resumes where it stopped. A
 * transient failure is retried in place (a later wake-up may be an hour away in the cloud); a
 * citation the providers refuse for good is left unchecked and the others go on. Near the end of
 * the invocation it yields, so the drain continues it in a fresh one.
 */
export async function runFactCheckJob(owner: string, signal: AbortSignal, deadline?: number): Promise<boolean | 'yield'> {
  const claim = await transaction('worker', async client => (await client.query('SELECT public.reporter_ed_fact_check_claim($1,$2) AS claim',
    [owner, LEASE_MS])).rows[0].claim as { runId: string; productionId: string; fence: string; citationIds: string[] } | null);
  if (!claim) return false;
  // Only this run's citations and their checks: the library may hold thousands.
  const ids = claim.citationIds.length ? claim.citationIds : ['-'];
  const scope = { productions: [claim.productionId], runs: [claim.runId], items: { citation: ids, fact_check: ids } };
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
      if (deadline !== undefined && Date.now() + CITATION_BUDGET_MS > deadline) {
        // Hand the rest to a fresh invocation: claimable now, and this claim does not count as an attempt.
        await guarded(async checkpoint => {
          const job = checkpoint.jobs[claim.runId];
          job.factCheck!.attempts = Math.max(0, job.factCheck!.attempts - 1); job.availableAt = Date.now(); delete job.lease;
        });
        return 'yield';
      }
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
      let result: Awaited<ReturnType<typeof runFactCheck>> | undefined;
      for (let tries = 1; !result; tries++) {
        try {
          result = await runFactCheck(next.subject, factCheckProviders(next.model), AbortSignal.any([combined, AbortSignal.timeout(150000)]));
        } catch (error) {
          const code = safeCode(error);
          if (combined.aborted || terminal(code) || !(error instanceof FlowError)) throw error;
          if (!error.retryable) { logEvent('worker', 'fact_check_skipped', { generation_id: claim.runId, error_code: code }); break; }
          // Another try only when it can finish inside this invocation; else the task is handed on.
          if (tries >= CITATION_TRIES || (deadline !== undefined && Date.now() + CITATION_BUDGET_MS > deadline)) throw error;
          await pause(Math.min(20000, Math.max(2000, error.waitSeconds * 1000)), combined);
        }
      }
      combined.throwIfAborted();
      await guarded(async checkpoint => {
        const saved = checkpoint.factChecks ?? [], previous = saved.find(item => item.id === next.id);
        // It had no check when picked: one there now was written meanwhile (a person, another run) and wins.
        if (result && !previous) checkpoint.factChecks = [...saved, recheck(undefined, result)];
        checkpoint.jobs[claim.runId].factCheck!.done += 1;
      });
    }
    logEvent('worker', 'fact_check_completed', { generation_id: claim.runId });
  } catch (error) {
    const code = safeCode(error);
    let retry = false;
    try {
      await guarded(async checkpoint => {
        const job = checkpoint.jobs[claim.runId], task = job.factCheck!;
        retry = !terminal(code) && task.attempts < MAX_ATTEMPTS && (signal.aborted || error instanceof FlowError && error.retryable);
        task.status = retry ? 'queued' : 'failed'; task.error = code; delete job.lease;
        // Claimable at once: a later time would wait for a wake-up that may be an hour away in the cloud.
        if (retry) job.availableAt = Date.now();
      });
    } catch { retry = false; /* An expired or replaced lease cannot commit even a failure. */ }
    logEvent('worker', 'fact_check_failed', { generation_id: claim.runId, error_code: code });
    // A fresh invocation takes the retry: this one may be near its end or its providers rate-limited.
    if (retry && deadline !== undefined) return 'yield';
  } finally { clearInterval(timer); }
  return true;
}
