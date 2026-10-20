import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { citationDay } from '../domain/citation-library.ts';
import { MAX_UPLOAD_BYTES } from '../domain/reporter.ts';
import { resolveServiceContext, transaction } from './database.ts';
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
const PART_CONCURRENCY = 4;
const PART_ATTEMPTS = 3;
// Ask again once the copy has most likely finished: an early sync would start a second copy.
const uploadWait = (size: number) => Math.min(300, 90 + Math.ceil(size / (16 * 1024 ** 2)) * 4);

const syncBody = z.object({
  fileId: z.string().regex(/^[A-Za-z0-9_-]{10,100}$/),
  name: z.string().trim().min(1).max(255).refine(name => !/[\x00-\x1f\x7f-\x9f\\/]/.test(name)),
  size: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
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
  const secret = driveSecret();
  if (!secret || request.method !== 'POST' || path.join('/') !== 'sync') throw new FlowError('NOT_FOUND', 404);
  if (!hasSecret(request, secret)) throw new FlowError('AUTH_REQUIRED', 401);
  if (reporterDeploymentMode() !== 'cloud') throw new FlowError('DRIVE_CLOUD_ONLY', 503);
  const input = syncBody.parse(await deps.readJson(request));
  if (!driveMedia(input.name)) throw new FlowError('UNSUPPORTED_MEDIA', 415);
  const email = process.env.REPORTER_DRIVE_OWNER_EMAIL?.trim();
  if (!email) throw new FlowError('DRIVE_OWNER_MISSING', 503);
  const context = await resolveServiceContext(email);
  if (!context) throw new FlowError('DRIVE_OWNER_UNKNOWN', 503);
  const app = new URL(request.url).origin;
  return runWithReporterContext(context, () => syncFile(input, secret, { app, worker: appOrigins()[0] ?? app }, context, deps.defer));
}

/** The address that opens a received file in the new-production steps. */
export function receivedHref(transcriptId: string) {
  return `/productions/new?material=${encodeURIComponent(transcriptId)}`;
}

/** GET drive/received (the board's Material lane) and drive/received/:id (one file, for the form). */
export async function driveReceived(path: string[]) {
  const id = path.length === 1 ? z.string().uuid().parse(path[0]) : path.length === 0 ? null : undefined;
  if (id === undefined) throw new FlowError('NOT_FOUND', 404);
  const items = await transaction('runtime', async client => (await client.query('SELECT public.reporter_drive_received($1) AS value', [id])).rows[0].value as unknown[]);
  if (id === null) return reply({ items });
  if (!items[0]) throw new FlowError('NOT_FOUND', 404);
  return reply(items[0]);
}

async function syncFile(input: SyncInput, secret: string, origins: { app: string; worker: string }, context: ReporterRequestContext, defer: Defer) {
  const ids = driveIds(secret, input.fileId), media = driveMedia(input.name)!;
  const name = input.name.normalize('NFC');
  const objectKey = `incoming/${context.portal}/${ids.sourceId}.${media.extension}`;
  const tokenHash = createHash('sha256').update(ids.token, 'utf8').digest('hex');
  // Preparing is idempotent per Drive file: the first sync registers the upload, every later
  // one finds the same transcript.
  const { prepared, transcript, stalled } = await transaction('runtime', async client => {
    const prepared = (await client.query('SELECT public.reporter_prepare_cloud_upload($1,$2,$3,$4,$5,$6,$7) AS value',
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
      defer(() => copyFromDrive({ endpoint, origin: origins.worker, sourceId: ids.sourceId, token: ids.token, fileId: input.fileId,
        accessToken: input.accessToken, size: input.size }).catch(error => { logEvent('api', 'drive_upload_failed', { error_code: safeCode(error) }); }));
      return reply({ ...base, stage: 'uploading', retryAfter: uploadWait(input.size) }, 202);
    }
    if (stalled && shouldHealStall()) defer(() => kickWorker());
    const progress = transcript.job.progress;
    return reply({ ...base, stage: 'transcribing', retryAfter: 60,
      ...(progress?.total ? { progress: Math.round((progress.done ?? 0) / progress.total * 100) } : {}) }, 202);
  }
  // Transcribed: it waits on the board until a person opens it in the new-production steps.
  return reply({ ...base, stage: 'ready', url: `${origins.app}${receivedHref(transcript.id)}` });
}

type UploadSession = { partSize: number; parts: { number: number; url: string }[] };

/** The browser's multipart upload, server to server: each part is read from Drive by byte range. */
async function copyFromDrive(job: { endpoint: string; origin: string; sourceId: string; token: string; fileId: string; accessToken: string; size: number }) {
  const call = async (path: string) => {
    const response = await fetch(new URL(path, job.endpoint.endsWith('/') ? job.endpoint : job.endpoint + '/'), { method: 'POST',
      headers: { 'content-type': 'application/json', origin: job.origin }, body: JSON.stringify({ sourceId: job.sourceId, token: job.token }),
      signal: AbortSignal.timeout(60_000) });
    const value = await response.json().catch(() => ({})) as { error?: unknown };
    if (!response.ok) throw new FlowError(typeof value.error === 'string' ? value.error : 'UPLOAD_FAILED', 503);
    return value;
  };
  const session = await call('uploads/start') as UploadSession;
  const pending = [...session.parts];
  const copy = async () => {
    for (let part = pending.shift(); part; part = pending.shift()) await copyPart(job, part, partRange(part.number, session.partSize, job.size));
  };
  await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, pending.length) }, copy));
  await call('uploads/complete');
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
