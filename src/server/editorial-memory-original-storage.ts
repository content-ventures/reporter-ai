import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, open, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { MAX_TEXT_BYTES } from '../domain/reporter.ts';
import { transaction } from './database.ts';
import { reporterDeploymentMode } from './deployment.ts';
import { FlowError } from './errors.ts';
import { currentReporterContext } from './request-context.ts';
import { storageRoot } from './storage.ts';
import { currentWorkerContext } from './worker-context.ts';
import { workerUrl } from './worker-config.ts';

export type MemoryOriginalObject = { checksum: string; size: number };
const object = z.object({ checksum: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().min(1).max(MAX_TEXT_BYTES) }).strict();
const scope = z.guid();
const bucket = 'reporter-source-media';
const client = new S3Client({ forcePathStyle: true, requestChecksumCalculation: 'WHEN_REQUIRED' });
const address = (portal: string, checksum: string) => `memory-originals/${scope.parse(portal)}/${checksum}.original`;
const workspace = () => scope.parse(currentWorkerContext()?.portal ?? currentReporterContext().portal);
function verified(input: MemoryOriginalObject, bytes: Buffer) {
  object.parse(input);
  if (bytes.length !== input.size || createHash('sha256').update(bytes).digest('hex') !== input.checksum) throw new FlowError('MEMORY_ORIGINAL_CHANGED', 422);
  return bytes;
}

const workerInput = object.extend({ action: z.enum(['read', 'write']), portal: scope,
  bytes: z.string().max(4 * Math.ceil(MAX_TEXT_BYTES / 3)).optional() }).strict();
/** Internal worker-secret endpoint only; public callers must authorize the original before storage. */
export async function workerMemoryOriginalObject(value: unknown): Promise<{ url?: string }> {
  const input = workerInput.parse(value), captured = currentWorkerContext();
  if (captured && captured.portal !== input.portal) throw new FlowError('WORKER_CONTEXT_CHANGED', 409);
  const key = address(input.portal, input.checksum);
  if (input.action === 'read') {
    if (input.bytes !== undefined) throw new FlowError('INVALID_INPUT', 422);
    return { url: await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key,
      ResponseContentType: 'application/octet-stream', ResponseContentDisposition: 'attachment', ResponseCacheControl: 'private, no-store' }), { expiresIn: 60 }) };
  }
  const bytes = Buffer.from(input.bytes ?? '', 'base64');
  if (bytes.toString('base64') !== input.bytes) throw new FlowError('INVALID_INPUT', 422);
  verified({ checksum: input.checksum, size: input.size }, bytes);
  // Content-addressed retries can write only the same verified bytes in this workspace.
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: 'application/octet-stream', CacheControl: 'private, no-store' }));
  return {};
}

async function gateway(input: MemoryOriginalObject & { action: 'read' | 'write'; bytes?: string }) {
  const payload = { ...input, portal: workspace() };
  if (process.env.REPORTER_FUNCTION_RUNTIME === 'true') return workerMemoryOriginalObject(payload);
  const endpoint = workerUrl() ?? await transaction('runtime', async db => (await db.query('SELECT public.reporter_object_endpoint() AS endpoint')).rows[0]?.endpoint);
  if (!endpoint || !process.env.REPORTER_WORKER_PASSWORD) throw new FlowError('UPLOAD_CONFIGURATION', 503);
  const response = await fetch(endpoint.replace(/\/+$/, '') + '/memory-objects', { method: 'POST', headers: {
    'content-type': 'application/json', 'x-reporter-worker-key': process.env.REPORTER_WORKER_PASSWORD,
  }, body: JSON.stringify(payload), signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new FlowError('MEMORY_ORIGINAL_UNAVAILABLE', 503);
  return await response.json() as { url?: string };
}

async function localBytes(path: string, input: MemoryOriginalObject) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size !== input.size) throw new FlowError('MEMORY_ORIGINAL_CHANGED', 422);
    const result = Buffer.alloc(input.size + 1); let length = 0;
    for (;;) {
      const read = await handle.read(result, length, result.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
      if (length > input.size) throw new FlowError('MEMORY_ORIGINAL_CHANGED', 422);
    }
    return verified(input, result.subarray(0, length));
  } finally { await handle.close(); }
}

/** The authenticated caller owns authorization; this layer preserves exact, private scoped bytes. */
export async function writeMemoryOriginalObject(input: MemoryOriginalObject, bytes: Buffer) {
  verified(input, bytes); const portal = workspace();
  if (reporterDeploymentMode() === 'cloud') { await gateway({ ...input, action: 'write', bytes: bytes.toString('base64') }); return; }
  const root = await storageRoot(), destination = join(root, `${portal}-${input.checksum}.memory-original`), temporary = join(root, `${randomUUID()}.memory-original.pending`);
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    try { await link(temporary, destination); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    await localBytes(destination, input);
  } finally { await rm(temporary, { force: true }); }
}
export async function readMemoryOriginalObject(input: MemoryOriginalObject): Promise<Buffer> {
  object.parse(input); const portal = workspace();
  if (reporterDeploymentMode() === 'local') return localBytes(join(await storageRoot(), `${portal}-${input.checksum}.memory-original`), input);
  const { url } = await gateway({ ...input, action: 'read' });
  if (!url) throw new FlowError('MEMORY_ORIGINAL_UNAVAILABLE', 503);
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: 'error' });
  if (!response.ok || !response.body) throw new FlowError('MEMORY_ORIGINAL_UNAVAILABLE', 422);
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > input.size) { await reader.cancel(); throw new FlowError('MEMORY_ORIGINAL_CHANGED', 422); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return verified(input, Buffer.concat(chunks));
}
