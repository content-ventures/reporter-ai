import { randomUUID,timingSafeEqual } from 'node:crypto';
import { attachDatabasePool } from '@neon/functions';
import { parseTriggerDelivery } from '@neon/functions/triggers';
import { z } from 'zod';
import { checkUploadStorage,completeCloudUpload,finalizeUploadedObject,startCloudUpload } from '../src/server/cloud-storage.ts';
import { checkMediaTools } from '../src/server/media.ts';
import { pool,transaction } from '../src/server/database.ts';
import { runEditorialJob } from '../src/server/editorial-worker.ts';
import { FlowError,logEvent,safeCode } from '../src/server/errors.ts';
import { runReporterJob } from '../src/server/reporter-worker-jobs.ts';

const MAX_INVOCATION_MS = 13*60*1000;
const MAX_JOBS_PER_INVOCATION = 20;

type WorkerDependencies = {
  ready?(): Promise<void>;
  heartbeat(owner: string,endpoint: string): Promise<void>;
  run(owner: string,signal: AbortSignal): Promise<boolean>;
  startUpload(sourceId: string,token: string): Promise<unknown>;
  completeUpload(sourceId: string,token: string): Promise<unknown>;
  finalizeObject(bucket: string,key: string): Promise<unknown>;
  now(): number;
};

const dependencies: WorkerDependencies = {
  ready: async () => { await Promise.all([checkUploadStorage(), checkMediaTools()]); },
  heartbeat: (owner,endpoint) => transaction('worker',async client => {
    await client.query('SELECT public.reporter_worker_register($1,$2)',[owner,endpoint]);
  }),
  run: async (owner,signal) => await runReporterJob(owner,signal) || await runEditorialJob(owner,signal),
  startUpload: startCloudUpload,
  completeUpload: completeCloudUpload,
  finalizeObject: finalizeUploadedObject,
  now: Date.now,
};

/** One scheduled invocation drains bounded durable work and can safely overlap. */
export async function drainEditorialQueue(owner: string,endpoint: string,signal: AbortSignal,services: WorkerDependencies = dependencies) {
  const startedAt = services.now();
  let processed = 0;
  await services.heartbeat(owner,endpoint);
  const heartbeat = setInterval(() => {
    void services.heartbeat(owner,endpoint).catch(error => logEvent('worker','heartbeat_failed',{ error_code: safeCode(error) }));
  },5000);
  heartbeat.unref?.();
  try {
    while (!signal.aborted && processed<MAX_JOBS_PER_INVOCATION && services.now()-startedAt<MAX_INVOCATION_MS) {
      if (!await services.run(owner,signal)) break;
      processed++;
    }
    return { processed,elapsedMs: services.now()-startedAt };
  } finally { clearInterval(heartbeat); }
}

if (process.env.NEON_BRANCH) attachDatabasePool(pool('worker'));

function matchesWorkerSecret(supplied: string | undefined) {
  const expected = process.env.REPORTER_WORKER_PASSWORD?.trim();
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected),right = Buffer.from(supplied);
  return left.length===right.length && timingSafeEqual(left,right);
}

async function hasWorkerSecret(request: Request) {
  const header = request.headers.get('x-reporter-worker-key')?.trim() || request.headers.get('authorization')?.replace(/^Bearer\s+/i,'').trim();
  if (matchesWorkerSecret(header)) return true;
  if (request.method!=='POST' || !request.headers.get('content-type')?.includes('application/json')) return false;
  try {
    const body = await request.clone().json() as { health_secret?: unknown };
    return typeof body.health_secret==='string' && matchesWorkerSecret(body.health_secret.trim());
  } catch { return false; }
}

function appOrigin() { return process.env.REPORTER_APP_ORIGIN?.trim() ?? ''; }
function uploadCors(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || origin!==appOrigin()) throw new FlowError('ORIGIN_DENIED',403);
  return { 'access-control-allow-origin': origin,'access-control-allow-methods': 'POST,OPTIONS',
    'access-control-allow-headers': 'content-type','access-control-max-age': '3600','vary': 'Origin',
    'cache-control': 'no-store','x-content-type-options': 'nosniff' };
}

const uploadBody = z.object({ sourceId: z.string().uuid(),token: z.string().min(32).max(128) }).strict();
async function uploadRequest(request: Request,services: WorkerDependencies,action: 'start' | 'complete') {
  let headers: Record<string,string>;
  try { headers = uploadCors(request); }
  catch { return Response.json({ error: 'ORIGIN_DENIED' },{ status: 403 }); }
  if (request.method==='OPTIONS') return new Response(null,{ status: 204,headers });
  if (request.method!=='POST') return Response.json({ error: 'METHOD_NOT_ALLOWED' },{ status: 405,headers });
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length>4096 || !request.headers.get('content-type')?.startsWith('application/json')) {
    return Response.json({ error: 'INVALID_UPLOAD_REQUEST' },{ status: 400,headers });
  }
  try {
    const input = uploadBody.parse(await request.json());
    const value = action==='start' ? await services.startUpload(input.sourceId,input.token) : await services.completeUpload(input.sourceId,input.token);
    return Response.json(value,{ headers });
  } catch (error) {
    const code = error instanceof z.ZodError ? 'INVALID_UPLOAD_REQUEST' : safeCode(error);
    const status = error instanceof FlowError ? error.status : code==='42501' ? 403 : code==='40001' ? 409 : 503;
    return Response.json({ error: code },{ status,headers });
  }
}

async function diagnosticHeartbeat(owner: string,endpoint: string,services: WorkerDependencies) {
  await services.heartbeat(owner,endpoint).catch(() => {});
}

export function createReporterWorker(services: WorkerDependencies = dependencies) {
  return { async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname==='/uploads/start') return uploadRequest(request,services,'start');
    if (url.pathname==='/uploads/complete') return uploadRequest(request,services,'complete');
    const endpoint = url.origin;
    if ((request.method==='GET' || request.method==='POST') && await hasWorkerSecret(request)) {
      try {
        await services.ready?.();
        await services.heartbeat(`reporter-health-${randomUUID()}`,endpoint);
        return Response.json({ ok: true });
      } catch (error) { return Response.json({ ok: false,error: safeCode(error) },{ status: 503 }); }
    }
    const triggerHeader = request.headers.get('x-neon-trigger-invocation-id')?.trim();
    if (request.method!=='POST') {
      if (triggerHeader) await diagnosticHeartbeat('reporter-trigger-invalid-method',endpoint,services);
      return new Response('Method Not Allowed',{ status: 405 });
    }
    const parsed = await parseTriggerDelivery(request);
    if (!parsed.ok) {
      if (triggerHeader) await diagnosticHeartbeat(`reporter-trigger-${parsed.error}`,endpoint,services);
      return new Response(parsed.error,{ status: parsed.error==='invalid_body' ? 400 : 401 });
    }
    if (parsed.invocation.type==='storage_object_created') {
      try {
        await services.finalizeObject(parsed.invocation.data.bucketName,parsed.invocation.data.objectKey);
        return Response.json({ ok: true });
      } catch (error) {
        logEvent('worker','storage_trigger_failed',{ error_code: safeCode(error) });
        return Response.json({ ok: false,error: 'UPLOAD_FINALIZE_FAILED' },{ status: 503 });
      }
    }
    const owner = `reporter-neon-${randomUUID()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('invocation_budget'),MAX_INVOCATION_MS);
    timeout.unref?.();
    try {
      const result = await drainEditorialQueue(owner,endpoint,controller.signal,services);
      logEvent('worker','scheduled_run_completed',{ duration_ms: result.elapsedMs });
      return Response.json({ ok: true,processed: result.processed });
    } catch (error) {
      logEvent('worker','scheduled_run_failed',{ error_code: safeCode(error) });
      return Response.json({ ok: false,error: 'WORKER_FAILED' },{ status: 503 });
    } finally { clearTimeout(timeout); }
  } };
}

export default createReporterWorker();
