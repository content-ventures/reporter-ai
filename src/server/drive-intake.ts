import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { citationDay } from '../domain/citation-library.ts';
import { MAX_DRIVE_BYTES } from '../domain/reporter.ts';
import { resolveServiceContext, resolveDriveBinding, driveRetryContext, transaction } from './database.ts';
import { reporterDeploymentMode } from './deployment.ts';
import { FlowError, logEvent, safeCode } from './errors.ts';
import { IDLE_QUEUE, queueStatus } from './queue-status.ts';
import { runWithReporterContext, type ReporterRequestContext } from './request-context.ts';
import { appOrigins, workerUrl } from './worker-config.ts';
import { kickWorker, shouldHealStall, type Defer } from './worker-kick.ts';
import { driveIds, driveMedia, folderFormat, partRange } from './drive-intake-plan.ts';

/**
 * Drive folder intake. A script attached to the event's Drive folder posts each new file here;
 * the server copies it from Drive into source storage (the browser's multipart upload, done
 * server to server) and the worker transcribes it. The file then waits on the board's Material
 * lane: a person opens it in the new-production steps, exactly as a file they uploaded. Every
 * step is idempotent per Drive file, so the script simply asks again.
 */

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files/';
const PART_CONCURRENCY = 6;
const PART_ATTEMPTS = 3;
// One sync copies for this long, inside the function's default 300 s. The next sync continues from
// the parts already stored, so a file of several gigabytes takes a few syncs.
const COPY_BUDGET_MS = 230_000;
// A sync holds the file this long: no second copy starts meanwhile, and a copy cut short frees it.
const COPY_LEASE_SECONDS = 300;
const PROGRESS_EVERY_MS = 15_000;
// Ask again about when this sync's copy ends.
const uploadWait = (size: number) => Math.min(COPY_LEASE_SECONDS, 90 + Math.ceil(size / (16 * 1024 ** 2)) * 4);

const syncBody = z.object({
  fileId: z.string().regex(/^[A-Za-z0-9_-]{10,100}$/),
  name: z.string().trim().min(1).max(255).refine(name => !/[\x00-\x1f\x7f-\x9f\\/]/.test(name)),
  // Drive's own size wins (driveSize): the script's is the fallback.
  size: z.number().int().safe(),
  folder: z.string().trim().max(120).optional(),
  recordedOn: z.string().refine(value => /^\d{4}-\d{2}-\d{2}$/.test(value) && citationDay(value)).optional(),
  accessToken: z.string().min(20).max(4096),
}).strict();
type SyncInput = z.infer<typeof syncBody>;

type Transcript = { id: string; status: string; error_code?: string | null;
  job?: { progress?: { done?: number; total?: number } | null } | null };

function driveSecret() {
  const value = process.env.REPORTER_DRIVE_SECRET?.trim();
  return value && value.length >= 32 ? value : undefined;
}

function hasSecret(request: Request, secret: string) {
  const supplied = Buffer.from(request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '');
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function reply(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

/** POST /api/reporter/drive/sync. Without REPORTER_DRIVE_SECRET the route does not exist. */
export async function handleDrive(request: Request, path: string[], deps: { readJson: (request: Request) => Promise<unknown>; defer: Defer }) {
  const legacy=path.join('/')==='sync';
  const bindingId=path.length===2&&path[1]==='sync'?z.uuid().safeParse(path[0]):undefined;
  if (request.method!=='POST' || !legacy&&!bindingId?.success) throw new FlowError('NOT_FOUND',404);
  if (reporterDeploymentMode() !== 'cloud') throw new FlowError('DRIVE_CLOUD_ONLY', 503);
  const supplied=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'').trim()??'';
  if(supplied.length<32||supplied.length>256)throw new FlowError('AUTH_REQUIRED',401);
  const binding=await resolveDriveBinding(bindingId?.success?bindingId.data:undefined,createHash('sha256').update(supplied).digest('hex'))
    .catch(()=>{throw new FlowError('AUTH_REQUIRED',401);});
  const secret=binding?.derivation??(legacy?driveSecret():undefined);
  if(!secret)throw new FlowError('NOT_FOUND',404);
  if(!binding&&!hasSecret(request,secret))throw new FlowError('AUTH_REQUIRED',401);
  const input = syncBody.parse(await deps.readJson(request));
  if (!driveMedia(input.name)) throw new FlowError('UNSUPPORTED_MEDIA', 415);
  const email = process.env.REPORTER_DRIVE_OWNER_EMAIL?.trim();
  if (!binding&&!email) throw new FlowError('DRIVE_OWNER_MISSING', 503);
  const context = binding?.context ?? await resolveServiceContext(email!);
  if (!context) throw new FlowError('DRIVE_OWNER_UNKNOWN', 503);
  const size = await driveSize(input.fileId, input.accessToken, input.size);
  if (size > MAX_DRIVE_BYTES) throw new FlowError('FILE_TOO_LARGE', 413);
  if (size < 1) throw new FlowError('INVALID_INPUT', 422);
  const app = new URL(request.url).origin;
  return runWithReporterContext(context, () => syncFile({ ...input, size }, secret, { app, worker: appOrigins()[0] ?? app,
    ...(binding?{workspaceSlug:context.workspaceSlug}:{}) }, context, deps.defer));
}

/** The file's size as Drive reports it; the script's value only when Drive does not answer. */
async function driveSize(fileId: string, accessToken: string, fallback: number) {
  try {
    const response = await fetch(`${DRIVE_FILES}${encodeURIComponent(fileId)}?fields=size&supportsAllDrives=true`, {
      headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
    const size = Number((await response.json() as { size?: unknown }).size);
    return response.ok && Number.isSafeInteger(size) && size > 0 ? size : fallback;
  } catch {
    return fallback;
  }
}

/** The address that opens a received file in the new-production steps. */
export function receivedHref(transcriptId: string,workspaceSlug?:string) {
  return `${workspaceSlug?'/w/'+encodeURIComponent(workspaceSlug):''}/productions/new?material=${encodeURIComponent(transcriptId)}`;
}

/** GET drive/received (the board's Material lane) and drive/received/:id (one file, for the form). */
export async function driveReceived(path: string[]) {
  const id = path.length === 1 ? z.string().uuid().parse(path[0]) : path.length === 0 ? null : undefined;
  if (id === undefined) throw new FlowError('NOT_FOUND', 404);
  // The intake runs only in the cloud: a local database has no received files (nor their table).
  if (reporterDeploymentMode() !== 'cloud') {
    if (id === null) return reply({ items: [] });
    throw new FlowError('NOT_FOUND', 404);
  }
  const items = await transaction('runtime', async client => (await client.query('SELECT public.reporter_drive_received($1) AS value', [id])).rows[0].value as unknown[]);
  if (id === null) return reply({ items });
  if (!items[0]) throw new FlowError('NOT_FOUND', 404);
  return reply(items[0]);
}

/**
 * POST drive/received/:id/retry: a failed transcription of a received file, queued again. The file
 * belongs to the member the intake uploads as, so the retry runs as that member, for any editor
 * who opens the card (a browser upload is retried by its own uploader).
 */
export async function driveRetry(id: string, body: unknown, key: string) {
  const transcriptId = z.string().uuid().parse(id);
  const { revision } = z.object({ revision: z.number().int().positive() }).strict().parse(body);
  if (reporterDeploymentMode() !== 'cloud') throw new FlowError('NOT_FOUND', 404);
  const received = await transaction('runtime', async client => (await client.query('SELECT public.reporter_drive_received($1) AS value', [transcriptId])).rows[0].value as unknown[]);
  if (!received[0]) throw new FlowError('NOT_FOUND', 404);
  const owner = await driveRetryContext(transcriptId);
  if (!owner) throw new FlowError('DRIVE_OWNER_UNKNOWN', 503);
  const generation = await runWithReporterContext(owner, () => transaction('runtime', async client => (await client.query(
    'SELECT public.reporter_retry($1,$2,$3,$4) AS value', ['transcript', transcriptId, revision, key])).rows[0].value as string));
  return reply({ id: transcriptId, generation_id: generation }, 202);
}

async function syncFile(input: SyncInput, secret: string, origins: { app: string; worker: string; workspaceSlug?:string }, context: ReporterRequestContext, defer: Defer) {
  const ids = driveIds(secret, input.fileId), media = driveMedia(input.name)!;
  const name = input.name.normalize('NFC');
  const objectKey = `incoming/${context.portal}/${ids.sourceId}.${media.extension}`;
  const tokenHash = createHash('sha256').update(ids.token, 'utf8').digest('hex');
  // Preparing is idempotent per Drive file: the first sync registers the upload, every later
  // one finds the same transcript.
  const { prepared, transcript, stalled } = await transaction('runtime', async client => {
    const existing=(await client.query('SELECT public.reporter_drive_source_transcript($1) AS value',[ids.sourceId])).rows[0].value as string|null;
    const prepared = existing ? {id:existing,upload_endpoint:null} : (await client.query('SELECT public.reporter_prepare_cloud_upload($1,$2,$3,$4,$5,$6,$7) AS value',
      [ids.sourceId, name, input.size, media.contentType, objectKey, tokenHash, ids.key])).rows[0].value as { id: string; upload_endpoint: string | null };
    await client.query('SELECT public.reporter_drive_intake_record($1,$2,$3,$4)', [prepared.id, name, folderFormat(input.folder) ?? null, input.recordedOn ?? null]);
    const transcript = (await client.query('SELECT public.reporter_local_transcript($1) AS value', [prepared.id])).rows[0].value as Transcript | null;
    const queue = transcript?.job && ['queued', 'processing'].includes(transcript.status) ? await queueStatus(client, `transcript:${prepared.id}`) : IDLE_QUEUE;
    return { prepared, transcript, stalled: queue.stalled };
  });
  if (!transcript) throw new FlowError('NOT_FOUND', 404);
  const base = { transcriptId: transcript.id };
  if (transcript.status === 'failed') return reply({ ...base, stage: 'failed', error: transcript.error_code ?? 'TRANSCRIPTION_FAILED' });
  if (transcript.status !== 'ready') {
    // No transcription job yet: the file has not reached storage.
    if (!transcript.job) {
      const endpoint = workerUrl() ?? prepared.upload_endpoint;
      if (!endpoint) throw new FlowError('UPLOAD_CONFIGURATION', 503);
      const copy = await transaction('runtime', async client => (await client.query('SELECT public.reporter_drive_copy_claim($1,$2) AS value',
        [transcript.id, COPY_LEASE_SECONDS])).rows[0].value as { claimed: boolean; copied: number; stalled: boolean });
      if (copy.stalled) return reply({ ...base, stage: 'failed', error: 'UPLOAD_FAILED' });
      const copied = Number(copy.copied);
      if (copy.claimed) defer(() => runWithReporterContext(context, () => copyFromDrive({ endpoint, origin: origins.worker, sourceId: ids.sourceId,
        token: ids.token, fileId: input.fileId, accessToken: input.accessToken, size: input.size, transcriptId: transcript.id }))
        .catch(error => { logEvent('api', 'drive_upload_failed', { error_code: safeCode(error) }); }));
      // While a copy runs or once part of the file is stored, the folder script reads "copying" as
      // progress, not as one of its few upload tries.
      return reply({ ...base, stage: copy.claimed && !copied ? 'uploading' : 'copying', retryAfter: copy.claimed ? uploadWait(input.size) : 60,
        ...(copied ? { progress: Math.min(99, Math.floor(copied / input.size * 100)) } : {}) }, 202);
    }
    if (stalled && shouldHealStall()) defer(() => kickWorker());
    const progress = transcript.job.progress;
    return reply({ ...base, stage: 'transcribing', retryAfter: 60,
      ...(progress?.total ? { progress: Math.round((progress.done ?? 0) / progress.total * 100) } : {}) }, 202);
  }
  // Transcribed: it waits on the board until a person opens it in the new-production steps.
  return reply({ ...base, stage: 'ready', url: `${origins.app}${receivedHref(transcript.id,origins.workspaceSlug)}` });
}

type UploadSession = { partSize: number; parts: { number: number; url: string }[]; uploaded?: number[] };

/**
 * The browser's multipart upload, server to server: each part is read from Drive by byte range.
 * One sync copies for COPY_BUDGET_MS at most, skipping the parts already stored, and records how
 * much is stored; the sync that copies the last part completes the upload.
 */
async function copyFromDrive(job: { endpoint: string; origin: string; sourceId: string; token: string; fileId: string; accessToken: string; size: number; transcriptId: string }) {
  const call = async (path: string) => {
    const response = await fetch(new URL(path, job.endpoint.endsWith('/') ? job.endpoint : job.endpoint + '/'), { method: 'POST',
      headers: { 'content-type': 'application/json', origin: job.origin }, body: JSON.stringify({ sourceId: job.sourceId, token: job.token }),
      signal: AbortSignal.timeout(60_000) });
    const value = await response.json().catch(() => ({})) as { error?: unknown };
    if (!response.ok) throw new FlowError(typeof value.error === 'string' ? value.error : 'UPLOAD_FAILED', 503);
    return value;
  };
  const deadline = Date.now() + COPY_BUDGET_MS;
  let copied = 0, reported = 0;
  const report = (release: boolean) => transaction('runtime', async client => {
    await client.query('SELECT public.reporter_drive_copy_progress($1,$2,$3)', [job.transcriptId, copied, release]);
  });
  try {
    const session = await call('uploads/start') as UploadSession;
    const stored = new Set(session.uploaded ?? []);
    const pending = session.parts.filter(part => !stored.has(part.number));
    const range = (part: { number: number }) => partRange(part.number, session.partSize, job.size);
    copied = job.size - pending.reduce((total, part) => total + range(part).length, 0);
    let failed = false;
    const copy = async () => {
      while (!failed && pending.length && Date.now() < deadline) {
        const part = pending.shift()!, bytes = range(part);
        try { await copyPart(job, part, bytes); }
        catch (error) { failed = true; throw error; }
        copied += bytes.length;
        if (Date.now() - reported >= PROGRESS_EVERY_MS) { reported = Date.now(); await report(false).catch(() => {}); }
      }
    };
    const results = await Promise.allSettled(Array.from({ length: Math.min(PART_CONCURRENCY, pending.length) }, copy));
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    // Out of time: the next sync continues from the parts stored so far.
    if (pending.length) return;
    await call('uploads/complete');
  } finally {
    await report(true).catch(() => {});
  }
}

async function copyPart(job: { fileId: string; accessToken: string; size: number }, part: { url: string }, range: { start: number; end: number; length: number }) {
  for (let attempt = 1; ; attempt++) {
    try {
      const download = await fetch(`${DRIVE_FILES}${encodeURIComponent(job.fileId)}?alt=media&supportsAllDrives=true`, {
        headers: { authorization: `Bearer ${job.accessToken}`, range: `bytes=${range.start}-${range.end}` }, signal: AbortSignal.timeout(120_000) });
      const whole = download.status === 200 && range.start === 0 && range.length === job.size;
      if (download.status !== 206 && !whole) {
        await download.body?.cancel().catch(() => {});
        throw new FlowError([401, 403].includes(download.status) ? 'DRIVE_ACCESS_DENIED' : download.status === 404 ? 'DRIVE_FILE_NOT_FOUND' : 'DRIVE_DOWNLOAD_FAILED', 502);
      }
      const bytes = Buffer.from(await download.arrayBuffer());
      if (bytes.length !== range.length) throw new FlowError('DRIVE_DOWNLOAD_FAILED', 502);
      const upload = await fetch(part.url, { method: 'PUT', body: bytes, signal: AbortSignal.timeout(120_000) });
      await upload.body?.cancel().catch(() => {});
      if (!upload.ok) throw new FlowError('UPLOAD_PART_FAILED', 502);
      return;
    } catch (error) {
      if (attempt >= PART_ATTEMPTS || ['DRIVE_ACCESS_DENIED', 'DRIVE_FILE_NOT_FOUND'].includes(safeCode(error))) throw error;
    }
  }
}
