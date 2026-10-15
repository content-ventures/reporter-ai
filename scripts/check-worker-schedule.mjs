import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

export async function waitForWorkerSchedule(query, endpoint, { attempts = 30, sleep = delay, since = new Date() } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    // Health and invalid-trigger diagnostics cannot satisfy this check. Require
    // an actual scheduled invocation after readiness, targeting this endpoint.
    const { rows } = await query(`SELECT EXISTS(SELECT FROM public.reporter_worker_heartbeats
      WHERE portal_id=$1 AND endpoint_url=$2 AND worker_id LIKE 'reporter-neon-%'
        AND seen_at>$3::timestamptz) AS ready`,
    ['10000000-0000-0000-0000-000000000101', endpoint, since.toISOString()]);
    if (rows[0]?.ready === true) return;
    if (attempt + 1 < attempts) await sleep(5000);
  }
  throw new Error('Neon schedule did not register a fresh worker heartbeat. Production release stopped.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const endpoint = process.env.NEON_FUNCTION_REPORTERWORKER_BASE_URL;
  const connection = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!endpoint || !connection) throw new Error('Worker schedule check is missing its endpoint or database configuration.');
  const url = new URL(connection); url.searchParams.set('sslmode', 'verify-full');
  const client = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000, application_name: 'reporter-release-schedule-check' });
  try {
    await client.connect();
    await waitForWorkerSchedule((...args) => client.query(...args), new URL(endpoint).origin);
    console.log('Neon schedule registered a fresh worker heartbeat after readiness.');
  } finally { await client.end(); }
}
