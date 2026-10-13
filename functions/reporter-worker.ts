import { randomUUID, timingSafeEqual } from 'node:crypto';
import { attachDatabasePool } from '@neon/functions';
import { parseTriggerDelivery } from '@neon/functions/triggers';
import { runEditorialJob } from '../src/server/editorial-worker.ts';
import { pool, transaction } from '../src/server/database.ts';
import { logEvent, safeCode } from '../src/server/errors.ts';

const MAX_INVOCATION_MS = 13 * 60 * 1000;
const MAX_JOBS_PER_INVOCATION = 20;

type WorkerDependencies = {
  heartbeat(owner: string): Promise<void>;
  run(owner: string, signal: AbortSignal): Promise<boolean>;
  now(): number;
};

const dependencies: WorkerDependencies = {
  heartbeat: owner => transaction('worker',async client => {
    await client.query('SELECT public.reporter_worker_heartbeat($1)',[owner]);
  }),
  run: runEditorialJob,
  now: Date.now,
};

/** One scheduled invocation drains bounded durable work and can safely overlap. */
export async function drainEditorialQueue(
  owner: string,
  signal: AbortSignal,
  services: WorkerDependencies = dependencies,
) {
  const startedAt = services.now();
  let processed = 0;
  await services.heartbeat(owner);
  const heartbeat = setInterval(() => {
    void services.heartbeat(owner).catch(error => {
      logEvent('worker','heartbeat_failed',{ error_code: safeCode(error) });
    });
  },5000);
  heartbeat.unref?.();
  try {
    while (!signal.aborted && processed < MAX_JOBS_PER_INVOCATION
      && services.now()-startedAt < MAX_INVOCATION_MS) {
      if (!await services.run(owner,signal)) break;
      processed++;
    }
    return { processed,elapsedMs: services.now()-startedAt };
  } finally {
    clearInterval(heartbeat);
  }
}

if (process.env.NEON_BRANCH) attachDatabasePool(pool('worker'));

function matchesWorkerSecret(supplied: string | undefined) {
  const expected = process.env.REPORTER_WORKER_PASSWORD?.trim();
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected),right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left,right);
}

async function hasWorkerSecret(request: Request) {
  const header = request.headers.get('x-reporter-worker-key')?.trim()
    || request.headers.get('authorization')?.replace(/^Bearer\s+/i,'').trim();
  if (matchesWorkerSecret(header)) return true;
  if (request.method !== 'POST' || !request.headers.get('content-type')?.includes('application/json')) return false;
  try {
    const body = await request.clone().json() as { health_secret?: unknown };
    return typeof body.health_secret === 'string' && matchesWorkerSecret(body.health_secret.trim());
  } catch { return false; }
}

async function diagnosticHeartbeat(owner: string,services: WorkerDependencies) {
  await services.heartbeat(owner).catch(() => {});
}

export function createReporterWorker(services: WorkerDependencies = dependencies) {
  return {
  async fetch(request: Request): Promise<Response> {
    if ((request.method === 'GET' || request.method === 'POST') && await hasWorkerSecret(request)) {
      try {
        await services.heartbeat(`reporter-health-${randomUUID()}`);
        return Response.json({ ok: true });
      } catch (error) {
        return Response.json({ ok: false,error: safeCode(error) },{ status: 503 });
      }
    }
    const triggerHeader = request.headers.get('x-neon-trigger-invocation-id')?.trim();
    if (request.method !== 'POST') {
      if (triggerHeader) await diagnosticHeartbeat('reporter-trigger-invalid-method',services);
      return new Response('Method Not Allowed',{ status: 405 });
    }
    const parsed = await parseTriggerDelivery(request);
    if (!parsed.ok) {
      if (triggerHeader) await diagnosticHeartbeat(`reporter-trigger-${parsed.error}`,services);
      return new Response(parsed.error,{ status: parsed.error === 'invalid_body' ? 400 : 401 });
    }
    if (parsed.invocation.type !== 'schedule') return new Response('Invalid trigger',{ status: 400 });
    const owner = `reporter-neon-${randomUUID()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('invocation_budget'),MAX_INVOCATION_MS);
    timeout.unref?.();
    try {
      const result = await drainEditorialQueue(owner,controller.signal,services);
      logEvent('worker','scheduled_run_completed',{ duration_ms: result.elapsedMs });
      return Response.json({ ok: true,processed: result.processed });
    } catch (error) {
      logEvent('worker','scheduled_run_failed',{ error_code: safeCode(error) });
      return Response.json({ ok: false,error: 'WORKER_FAILED' },{ status: 503 });
    } finally {
      clearTimeout(timeout);
    }
  },
  };
}

export default createReporterWorker();
