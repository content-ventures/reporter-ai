import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Asks the deployed worker for one complete drain pass and returns its receipt. Passing proves
 * the function authenticates, reaches PostgreSQL and runs the deployed queue SQL; it replaces
 * waiting for a heartbeat from a schedule that now fires only hourly.
 */
export async function drainReceipt(endpoint, secret, { request = fetch, timeoutMs = 14 * 60_000 } = {}) {
  let response;
  try {
    response = await request(new URL('/drain?wait=1', endpoint), { method: 'POST', headers: { 'x-reporter-worker-key': secret },
      signal: AbortSignal.timeout(timeoutMs) });
  } catch { throw new Error('Worker drain failed: WORKER_UNREACHABLE'); }
  const receipt = await response.json().catch(() => ({}));
  if (!response.ok || receipt.ok !== true) {
    const code = typeof receipt.error === 'string' && /^[A-Z0-9_]{1,64}$/.test(receipt.error) ? receipt.error : `HTTP_${response.status}`;
    throw new Error(`Worker drain failed: ${code}`);
  }
  return { processed: Number(receipt.processed) || 0, remaining: receipt.remaining === true, elapsedMs: Number(receipt.elapsedMs) || 0 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const endpoint = process.env.NEON_FUNCTION_REPORTERWORKER_BASE_URL, secret = process.env.REPORTER_WORKER_PASSWORD;
  if (!endpoint || !secret) throw new Error('The drain check needs the worker URL and password.');
  try {
    const receipt = await drainReceipt(endpoint, secret);
    const line = `Worker drain receipt: ${receipt.processed} job(s) processed in ${receipt.elapsedMs} ms; work remaining: ${receipt.remaining ? 'yes, chained' : 'no'}.`;
    console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
