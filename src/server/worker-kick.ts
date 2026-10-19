import 'server-only';
import { reporterDeploymentMode } from './deployment.ts';
import { logEvent, safeCode } from './errors.ts';
import { workerUrl } from './worker-config.ts';

/** Runs work after the response is sent (Next `after` in route handlers, a stub in tests). */
export type Defer = (task: () => Promise<void>) => void;

const HEAL_INTERVAL_MS = 60_000;
let lastHeal = Number.NEGATIVE_INFINITY;

/** Wake the cloud worker once work is committed. Local mode runs its own polling loop. */
export async function kickWorker(request: typeof fetch = fetch) {
  if (reporterDeploymentMode() !== 'cloud') return;
  let url: string | undefined;
  try { url = workerUrl(); } catch (error) { logEvent('api', 'worker_kick_failed', { error_code: safeCode(error) }); return; }
  const secret = process.env.REPORTER_WORKER_PASSWORD?.trim();
  if (!url || !secret) { logEvent('api', 'worker_kick_unconfigured'); return; }
  try {
    const response = await request(url + '/drain', { method: 'POST', signal: AbortSignal.timeout(5_000),
      headers: { 'x-reporter-worker-key': secret } });
    await response.body?.cancel();
    if (response.status !== 202) logEvent('api', 'worker_kick_failed', { error_code: `HTTP_${response.status}` });
  } catch (error) { logEvent('api', 'worker_kick_failed', { error_code: safeCode(error) }); }
}

let lastNewsWake = Number.NEGATIVE_INFINITY;

/** A radar poll that finds a source due wakes the worker, at most once a minute per server instance. */
export function shouldWakeForNews(now = Date.now()) {
  if (now - lastNewsWake < HEAL_INTERVAL_MS) return false;
  lastNewsWake = now;
  return true;
}

/** A stall seen by a poll wakes the worker again, at most once a minute per server instance. */
export function shouldHealStall(now = Date.now()) {
  if (now - lastHeal < HEAL_INTERVAL_MS) return false;
  lastHeal = now;
  return true;
}
