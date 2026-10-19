import 'server-only';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { assertLocalMode,groqKey } from './config.ts';
import { pool } from './database.ts';
import { reporterDeploymentMode } from './deployment.ts';
import { runEditorialJob } from './editorial-worker.ts';
import { runArticleImageJob } from './article-image-worker.ts';
import { runFactCheckJob } from './fact-check-worker.ts';
import { runNewsSource } from './news-reader.ts';
import { logEvent,safeCode } from './errors.ts';
import { runReporterJob } from './reporter-worker-jobs.ts';
import { compactEditorialRows } from './worker-drain.ts';
import { cacheWrite,storageRoot } from './storage.ts';

const owner = 'reporter-'+randomUUID();
let stopping = false,active: AbortController | undefined;
for (const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,() => { stopping = true;active?.abort(); });

async function main() {
  const local = reporterDeploymentMode()==='local';
  if (local) assertLocalMode();
  groqKey();
  const root = await storageRoot();
  // Local mode tells the app it is running through a file; cloud work is woken on demand.
  const heartbeat = () => local ? cacheWrite(root,'worker',{ timestamp: Date.now(),owner }).catch(() => {}) : Promise.resolve();
  await heartbeat();
  const timer = setInterval(heartbeat,5000);
  logEvent('worker','worker_started');
  try {
    while (!stopping) {
      try {
        active = new AbortController();
        const ran = await runReporterJob(owner,active.signal) || await runEditorialJob(owner,active.signal) || await runArticleImageJob(owner,active.signal) || await runFactCheckJob(owner,active.signal) || await runNewsSource(owner,active.signal);
        active = undefined;
        if (ran) await compactEditorialRows().catch(error => logEvent('worker','compaction_failed',{ error_code: safeCode(error) }));
        else await delay(1000);
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
