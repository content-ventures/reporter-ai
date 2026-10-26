import 'server-only';
import { randomUUID } from 'node:crypto';
import { transaction } from './database.ts';
import { runEditorialJob } from './editorial-worker.ts';
import { runArticleImageJob } from './article-image-worker.ts';
import { runFactCheckJob } from './fact-check-worker.ts';
import { logEvent, safeCode } from './errors.ts';
import { runNewsSearchJob } from './news-search-worker.ts';
import { runNewsSource } from './news-reader.ts';
import { runNewsTranslationJob } from './news-translation-worker.ts';
import { runRemoteIngest } from './remote-ingest.ts';
import { runReporterJob } from './reporter-worker-jobs.ts';
import { workerUrl } from './worker-config.ts';
import { withWorkspaceWork } from './worker-dispatch.ts';
import { currentWorkerContext } from './worker-context.ts';

export const MAX_INVOCATION_MS = 13 * 60 * 1000;
export const MAX_JOBS_PER_INVOCATION = 20;
export const MAX_DRAIN_CHAIN = 8;
export const COMPACT_INTERVAL_MS = 10 * 60 * 1000;

export type DrainResult = { processed: number; remaining: boolean; elapsedMs: number };
export type DrainServices = {
  pending(): Promise<boolean>;
  /** true: one job ran; false: nothing claimable; 'yield': stop and continue in a fresh invocation. */
  run(owner: string, signal: AbortSignal, deadline: number): Promise<boolean | 'yield'>;
  now(): number;
  /** Housekeeping after work; never called by a drain that found nothing to do. */
  compact?(): Promise<void>;
};

const compactedAt = new Map<string,number>();
/**
 * Drops finished runs' event streams, expired receipts and old tombstones, at most every ten
 * minutes per isolate. It rides on drains that did work, so an idle database is never woken.
 */
export async function compactEditorialRows(now = Date.now()) {
  const context = currentWorkerContext();
  if (!context || now - (compactedAt.get(context.portal) ?? Number.NEGATIVE_INFINITY) < COMPACT_INTERVAL_MS) return;
  await transaction('worker', client => client.query('SELECT public.reporter_ed_compact()'));
  compactedAt.set(context.portal,now);
  for (const [portal,at] of compactedAt) if (now-at>COMPACT_INTERVAL_MS) compactedAt.delete(portal);
}

export const drainServices: DrainServices = {
  pending: () => transaction('worker', async client =>
    (await client.query('SELECT public.reporter_worker_pending() AS pending')).rows[0]?.pending === true),
  run: (owner, signal, deadline) => withWorkspaceWork('any',owner,signal,async scoped => {
    const ran = await runRemoteIngest(owner, scoped)
      || await runReporterJob(owner, scoped, deadline) || await runEditorialJob(owner, scoped) || await runArticleImageJob(owner, scoped)
      || await runFactCheckJob(owner, scoped, deadline) || await runNewsSource(owner, scoped)
      || await runNewsSearchJob(owner, scoped, deadline) || await runNewsTranslationJob(owner, scoped, deadline);
    if (ran && !scoped.aborted) await compactEditorialRows().catch(error => logEvent('worker','compaction_failed',{ error_code: safeCode(error) }));
    return ran || await transaction('worker',async client=>(await client.query('SELECT public.reporter_worker_archive_maintenance() AS value')).rows[0]?.value===true);
  }),
  now: Date.now,
  compact: () => compactEditorialRows(),
};

/** One bounded pass over claimable work. An empty queue costs one read and writes nothing. */
export async function drainQueue(owner: string, signal: AbortSignal, services: DrainServices = drainServices,
  limits = { maxMs: MAX_INVOCATION_MS, maxJobs: MAX_JOBS_PER_INVOCATION }): Promise<DrainResult> {
  const startedAt = services.now(), deadline = startedAt + limits.maxMs;
  const result = (processed: number, remaining: boolean) => ({ processed, remaining, elapsedMs: services.now() - startedAt });
  if (signal.aborted || !await services.pending()) return result(0, false);
  let processed = 0, remaining = true;
  while (!signal.aborted && processed < limits.maxJobs && services.now() < deadline) {
    const ran = await services.run(owner, signal, deadline);
    if (ran === 'yield') break;
    if (!ran) { remaining = false; break; }
    processed++;
  }
  if (processed > 0 && !signal.aborted) {
    await services.compact?.().catch(error => logEvent('worker', 'compaction_failed', { error_code: safeCode(error) }));
  }
  return result(processed, remaining);
}

export type DrainScheduler = (depth?: number) => Promise<DrainResult>;

/**
 * One drain at a time per isolate. A kick during a drain asks for one more pass, so work
 * enqueued after the last pending check is not missed. Work left at the end of the
 * invocation budget continues in a new invocation, never in this one.
 */
export function createDrainScheduler(deps: {
  drain(owner: string, signal: AbortSignal): Promise<DrainResult>;
  chain(depth: number): Promise<void>;
  maxMs?: number;
  maxDepth?: number;
}): DrainScheduler {
  let active: Promise<DrainResult> | undefined;
  let again = false;
  return (depth = 0) => {
    if (active) { again = true; return active; }
    const { promise,resolve,reject } = Promise.withResolvers<DrainResult>();
    active = promise;
    void (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort('invocation_budget'), deps.maxMs ?? MAX_INVOCATION_MS);
      timer.unref?.();
      try {
        let result: DrainResult;
        do {
          again = false;
          result = await deps.drain(`reporter-neon-${randomUUID()}`, controller.signal);
        } while (again && !result.remaining && !controller.signal.aborted);
        if (result.remaining || controller.signal.aborted) {
          // The authenticated continuation may land on this same isolate. It must own a
          // fresh drain, rather than rejoining the promise whose budget was exhausted.
          if (active === promise) active = undefined;
          if (depth < (deps.maxDepth ?? MAX_DRAIN_CHAIN)) await deps.chain(depth + 1);
          else logEvent('worker', 'drain_chain_exhausted');
        }
        return result;
      } finally { clearTimeout(timer); if (active === promise) active = undefined; }
    })().then(resolve,reject);
    return promise;
  };
}

/** Continue in a fresh invocation through the worker's own authenticated drain route. */
export async function chainDrain(depth: number, request: typeof fetch = fetch) {
  const url = workerUrl(), secret = process.env.REPORTER_WORKER_PASSWORD?.trim();
  if (!url || !secret) { logEvent('worker', 'drain_chain_unconfigured'); return; }
  try {
    const response = await request(url + '/drain', { method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { 'x-reporter-worker-key': secret, 'x-reporter-drain-depth': String(depth) } });
    await response.body?.cancel();
    if (!response.ok) logEvent('worker', 'drain_chain_failed', { error_code: `HTTP_${response.status}` });
  } catch (error) { logEvent('worker', 'drain_chain_failed', { error_code: safeCode(error) }); }
}
