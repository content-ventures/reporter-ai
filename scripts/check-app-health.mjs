import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/** The same fingerprint the app publishes for the worker it wakes (src/server/app-config.ts). */
export function workerFingerprint(url) {
  if (!url?.trim()) return null;
  try { return createHash('sha256').update(new URL(url.trim()).origin).digest('hex').slice(0, 16); }
  catch { return 'invalid'; }
}

/** Everything that keeps a deployed app from being the expected, fully configured release. */
export function healthProblems(health, expected = {}) {
  if (health?.service !== 'reporter-ai') return ['the URL does not answer as the Reporter app'];
  const problems = [];
  if (expected.version && health.version !== expected.version) problems.push(`version ${health.version}, expected ${expected.version}`);
  if (expected.commit && health.commit !== expected.commit) problems.push(`commit ${String(health.commit).slice(0, 12)}, expected ${expected.commit.slice(0, 12)}`);
  const missing = Object.entries(health.configured ?? {}).filter(([, ok]) => !ok).map(([name]) => name);
  if (!health.ready) problems.push(`missing settings: ${missing.join(', ') || 'unknown'}`);
  if (expected.worker && health.worker !== workerFingerprint(expected.worker)) problems.push('the app wakes a different worker');
  return problems;
}

/**
 * Polls the public probe until the deployment reports the expected release, read-only.
 * @param {string | URL} baseUrl
 * @param {{ version?: string, commit?: string, worker?: string }} [expected]
 * @param {{ attempts?: number, sleep?: (ms: number) => Promise<unknown>, request?: (url: URL, init: RequestInit) => Promise<Response> }} [options]
 */
export async function waitForAppHealth(baseUrl, expected = {}, { attempts = 60, sleep = delay, request = fetch } = {}) {
  let last = 'unreachable';
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await request(new URL('/api/reporter/health', baseUrl), { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(15_000) });
      if (response.ok) {
        const health = await response.json();
        const problems = healthProblems(health, expected);
        if (!problems.length) return health;
        last = problems.join('; ');
      } else { await response.body?.cancel(); last = `HTTP ${response.status}`; }
    } catch { last = 'unreachable'; }
    if (attempt + 1 < attempts) await sleep(10_000);
  }
  throw new Error(`The app at ${new URL(baseUrl).origin} did not report the expected release: ${last}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { url: { type: 'string' }, version: { type: 'string' }, commit: { type: 'string' },
    'worker-url': { type: 'string' }, attempts: { type: 'string' } } });
  if (!values.url) throw new Error('Use: pnpm cloud:check -- --url https://app [--version x.y.z] [--commit sha] [--worker-url https://worker]');
  try {
    const health = await waitForAppHealth(values.url, { version: values.version, commit: values.commit, worker: values['worker-url'] },
      { attempts: Number(values.attempts ?? 1) });
    console.log(`Reporter ${health.version} (${String(health.commit).slice(0, 12)}, ${health.environment}) is ready.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
