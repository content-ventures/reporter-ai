import { timingSafeEqual } from 'node:crypto';
import { attachDatabasePool, waitUntil } from '@neon/functions';
import { parseTriggerDelivery } from '@neon/functions/triggers';
import { z } from 'zod';
import { checkUploadStorage,completeCloudUpload,finalizeUploadedObject,startCloudUpload } from '../src/server/cloud-storage.ts';
import { checkMediaTools } from '../src/server/media.ts';
import { pool,transaction } from '../src/server/database.ts';
import { FlowError,logEvent,safeCode } from '../src/server/errors.ts';
import { workerImageObject } from '../src/server/image-storage.ts';
import { workerMediaDiagnostics } from '../src/server/worker-media.ts';
import { appOrigins } from '../src/server/worker-config.ts';
import { chainDrain,createDrainScheduler,drainQueue,type DrainResult } from '../src/server/worker-drain.ts';

// The hourly safety sweep runs at most this often per isolate, whatever deliveries arrive.
const SWEEP_INTERVAL_MS = 5*60*1000;
const SOURCE_KEY = /^incoming\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:mp3|mp4|m4a|wav|ogg|flac|webm)$/i;

export async function workerDependency<T>(component: 'MEDIA'|'STORAGE'|'DATABASE',operation:()=>Promise<T>):Promise<T>{
  try{return await operation();}catch(error){
    if(error instanceof FlowError)throw error;
    const failure=error as {code?:string;name?:string;$metadata?:{httpStatusCode?:number}};
    const allowed=new Set(['ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENOTFOUND','EACCES','EPERM','EROFS','ENOSYS','ERR_TLS_CERT_ALTNAME_INVALID','UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT']);
    const code=failure?.code&&(/^[0-9A-Z]{5}$/.test(failure.code)||allowed.has(failure.code))?failure.code
      :failure?.$metadata?.httpStatusCode?`HTTP_${failure.$metadata.httpStatusCode}`
      :['TypeError','RangeError','AccessDenied','NoSuchBucket','InvalidAccessKeyId','SignatureDoesNotMatch','ExpiredToken'].includes(failure?.name??'')?failure.name!.toUpperCase():'UNAVAILABLE';
    throw new FlowError(`WORKER_${component}_${code}`,503);
  }
}

export type WorkerDependencies = {
  ready?(): Promise<void>;
  ping(): Promise<void>;
  rejectedTrigger?(code: string): void;
  drain(owner: string,signal: AbortSignal): Promise<DrainResult>;
  chain(depth: number): Promise<void>;
  defer(work: Promise<unknown>): void;
  startUpload(sourceId: string,token: string): Promise<unknown>;
  completeUpload(sourceId: string,token: string): Promise<unknown>;
  finalizeObject(bucket: string,key: string): Promise<unknown>;
  now(): number;
};

const dependencies: WorkerDependencies = {
  ready: async () => { await Promise.all([workerDependency('STORAGE',checkUploadStorage),workerDependency('MEDIA',checkMediaTools)]); },
  ping: () => transaction('worker',async client => { await client.query('SELECT 1'); }),
  rejectedTrigger: code => {
    // Neon captures console output. Keep diagnostics to a bounded operational
    // code: no header values, request body, URL, credentials or editorial data.
    console.warn(JSON.stringify({ component: 'worker',message: 'trigger_rejected',error_code: code }));
  },
  drain: (owner,signal) => drainQueue(owner,signal),
  chain: depth => chainDrain(depth),
  defer: work => waitUntil(work),
  startUpload: startCloudUpload,
  completeUpload: completeCloudUpload,
  finalizeObject: finalizeUploadedObject,
  now: Date.now,
};

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

function uploadCors(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || !appOrigins().includes(origin)) throw new FlowError('ORIGIN_DENIED',403);
  return { 'access-control-allow-origin': origin,'access-control-allow-methods': 'POST,OPTIONS',
    'access-control-allow-headers': 'content-type','access-control-max-age': '3600','vary': 'Origin',
    'cache-control': 'no-store','x-content-type-options': 'nosniff' };
}

const uploadBody = z.object({ sourceId: z.string().uuid(),token: z.string().min(32).max(128) }).strict();
async function uploadRequest(request: Request,services: WorkerDependencies,action: 'start' | 'complete',kick: () => void) {
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
    // A completed upload is already registered for transcription; start it now rather
    // than waiting for the storage trigger or the hourly sweep.
    if (action==='complete') kick();
    return Response.json(value,{ headers });
  } catch (error) {
    const code = error instanceof z.ZodError ? 'INVALID_UPLOAD_REQUEST' : safeCode(error);
    const status = error instanceof FlowError ? error.status : code==='42501' ? 403 : code==='40001' ? 409 : 503;
    return Response.json({ error: code },{ status,headers });
  }
}

async function parseWorkerTrigger(request: Request) {
  if (!request.headers.get('x-neon-trigger-invocation-id')?.trim()) return { ok: false,error: 'missing_header' } as const;
  try {
    // Use the SDK's explicit-data overload. Hosted Request implementations need
    // not share Node's global Request constructor or its clone implementation.
    return parseTriggerDelivery({ headers: request.headers,body: await request.json() });
  } catch { return { ok: false,error: 'invalid_body' } as const; }
}

export function createReporterWorker(services: WorkerDependencies = dependencies) {
  const schedule = createDrainScheduler({ drain: services.drain,chain: services.chain });
  let lastSweep = Number.NEGATIVE_INFINITY;
  const kick = (depth = 0) => services.defer(schedule(depth).catch(error => {
    logEvent('worker','drain_failed',{ error_code: safeCode(error) });
  }));
  const rejected = (code: string,response: Response) => { services.rejectedTrigger?.(code); return response; };

  return { async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/objects') {
      if (request.method !== 'POST' || !await hasWorkerSecret(request)) return new Response('Unauthorized',{status:401});
      try {
        const input = z.object({ action: z.enum(['read','prepare','write']),key: z.string().max(200),mime: z.string().optional(),bytes: z.string().max(14*1024**2).optional() }).strict().parse(await request.json());
        return Response.json(await workerImageObject(input));
      } catch (error) { return Response.json({error:safeCode(error)},{status:error instanceof FlowError?error.status:503}); }
    }
    if (url.pathname==='/uploads/start') return uploadRequest(request,services,'start',kick);
    if (url.pathname==='/uploads/complete') return uploadRequest(request,services,'complete',kick);
    if (url.pathname==='/drain') {
      if (request.method!=='POST' || !await hasWorkerSecret(request)) return new Response('Unauthorized',{ status: 401 });
      const depth = Math.min(Math.max(Number(request.headers.get('x-reporter-drain-depth')) || 0,0),64);
      // Release verification waits for one complete pass; every other caller is answered at once.
      if (url.searchParams.get('wait')==='1') {
        try { return Response.json({ ok: true,...await schedule(depth) }); }
        catch (error) { return Response.json({ ok: false,error: safeCode(error) },{ status: 503 }); }
      }
      kick(depth);
      return Response.json({ accepted: true },{ status: 202 });
    }
    if (url.pathname==='/triggers/schedule' || url.pathname==='/triggers/storage') {
      if (request.method!=='POST') return rejected('TRIGGER_METHOD',new Response('Method Not Allowed',{ status: 405 }));
      const parsed = await parseWorkerTrigger(request);
      if (!parsed.ok) return rejected(`TRIGGER_${parsed.error.toUpperCase()}`,new Response(parsed.error,{ status: parsed.error==='invalid_body' ? 400 : 401 }));
      if (url.pathname==='/triggers/storage') {
        if (parsed.invocation.type!=='storage_object_created' || !SOURCE_KEY.test(parsed.invocation.data.objectKey))
          return rejected('TRIGGER_TYPE_MISMATCH',new Response('invalid_body',{ status: 400 }));
        try {
          await services.finalizeObject(parsed.invocation.data.bucketName,parsed.invocation.data.objectKey);
          kick();
          return Response.json({ ok: true });
        } catch (error) {
          logEvent('worker','storage_trigger_failed',{ error_code: safeCode(error) });
          return Response.json({ ok: false,error: 'UPLOAD_FINALIZE_FAILED' },{ status: 503 });
        }
      }
      if (parsed.invocation.type!=='schedule') return rejected('TRIGGER_TYPE_MISMATCH',new Response('invalid_body',{ status: 400 }));
      // Trigger deliveries are not signed: a forged burst can cost at most one pending
      // check per isolate every few minutes, never a write.
      if (services.now()-lastSweep>=SWEEP_INTERVAL_MS) { lastSweep = services.now(); kick(); }
      return Response.json({ accepted: true },{ status: 202 });
    }
    if ((request.method==='GET' || request.method==='POST') && url.pathname==='/' && await hasWorkerSecret(request)) {
      try {
        await services.ready?.();
        await workerDependency('DATABASE',services.ping);
        return Response.json({ ok: true });
      } catch (error) {
        const code=safeCode(error);console.warn(JSON.stringify({component:'worker',message:'readiness_failed',error_code:code}));
        return Response.json({ ok: false,error: code,...(code.startsWith('MEDIA_TOOL_')?{media:await workerMediaDiagnostics()}:{}),sourceCommit:process.env.REPORTER_SOURCE_COMMIT },{ status: 503 });
      }
    }
    return rejected('UNKNOWN_ROUTE',new Response('Not Found',{ status: 404 }));
  } };
}

export default createReporterWorker();
