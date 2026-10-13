import 'server-only';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { assertLocalMode,groqKey } from './config.ts';
import { pool,transaction } from './database.ts';
import { reporterDeploymentMode } from './deployment.ts';
import { runEditorialJob } from './editorial-worker.ts';
import { logEvent,safeCode } from './errors.ts';
import { runReporterJob } from './reporter-worker-jobs.ts';
import { cacheWrite,storageRoot } from './storage.ts';

const owner = 'reporter-'+randomUUID();
let stopping = false,active: AbortController | undefined;
for (const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,() => { stopping = true;active?.abort(); });

async function main() {
  const local = reporterDeploymentMode()==='local';
  if (local) assertLocalMode();
  groqKey();
  const root = await storageRoot();
  const heartbeat = () => (local
    ? cacheWrite(root,'worker',{ timestamp: Date.now(),owner })
    : transaction('worker',async client => { await client.query('SELECT public.reporter_worker_heartbeat($1)',[owner]); })).catch(() => {});
  await heartbeat();
  const timer = setInterval(heartbeat,5000);
  logEvent('worker','worker_started');
  try {
    while (!stopping) {
      try {
        active = new AbortController();
        if (!await runReporterJob(owner,active.signal) && !await runEditorialJob(owner,active.signal)) await delay(1000);
        active = undefined;
      } catch (error) {
        active = undefined;
        logEvent('worker','queue_unavailable',{ error_code: safeCode(error) });
        await delay(5000);
      }
    }
  } finally {
    clearInterval(timer);await pool('worker').end();logEvent('worker','worker_stopped');
  }
}

main().catch(error => { logEvent('worker','startup_failed',{ error_code: safeCode(error) });process.exitCode = 1; });
