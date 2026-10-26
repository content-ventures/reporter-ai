import 'server-only';
import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { transaction } from './database.ts';
import { currentReporterContext } from './request-context.ts';
import { cloudPortalId } from './config.ts';
import { reporterDeploymentMode } from './deployment.ts';
import { storageRoot } from './storage.ts';
import { FlowError } from './errors.ts';
import { workerUrl } from './worker-config.ts';
import { currentWorkerContext, requireWorkerContext } from './worker-context.ts';

const bucket = 'reporter-source-media';
const client = new S3Client({ forcePathStyle: true,requestChecksumCalculation: 'WHEN_REQUIRED' });
export const imageFileKey = /^[a-f0-9]{64}\.(?:photo\.jpg|image)$/;
const objectKey = /^images\/[0-9a-f-]{36}\/[a-f0-9]{64}\.(?:photo\.jpg|image)$/;
function portal() {
  if (currentWorkerContext() || process.env.REPORTER_FUNCTION_RUNTIME === 'true') return requireWorkerContext().portal;
  return currentReporterContext().portal;
}
function key(fileKey: string, workspaceId = portal()) {
  if (!imageFileKey.test(fileKey)) throw new FlowError('UNSAFE_STORAGE',500);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(workspaceId)) throw new FlowError('UNSAFE_STORAGE',500);
  return `images/${workspaceId}/${fileKey}`;
}

/** Only the authenticated server and the worker use this gateway; browsers receive signed PUT/GET URLs. */
export async function workerImageObject(input: { action: 'read' | 'prepare' | 'write'; key: string; portal?: string; mime?: string; bytes?: string }) {
  if (!objectKey.test(input.key) || !input.key.startsWith(`images/${input.portal ?? cloudPortalId()}/`)) throw new FlowError('UNSAFE_STORAGE',403);
  if (input.action === 'read') return { url: await getSignedUrl(client,new GetObjectCommand({ Bucket: bucket,Key: input.key }),{ expiresIn: 300 }) };
  if (!['image/jpeg','image/png','image/webp','image/gif'].includes(input.mime ?? '')) throw new FlowError('UNSUPPORTED_MEDIA',415);
  if (input.action === 'prepare') return { url: await getSignedUrl(client,new PutObjectCommand({ Bucket: bucket,Key: input.key,ContentType: input.mime }),{ expiresIn: 300 }) };
  const bytes = Buffer.from(input.bytes ?? '', 'base64');
  if (!bytes.length || bytes.length > 10*1024**2 || createHash('sha256').update(bytes).digest('hex') !== input.key.split('/').at(-1)?.slice(0,64)) throw new FlowError('IMAGE_TOO_LARGE',422);
  await client.send(new PutObjectCommand({ Bucket: bucket,Key: input.key,Body: bytes,ContentType: input.mime }));
  return {};
}

async function gateway(input: Parameters<typeof workerImageObject>[0]) {
  input = { ...input,portal: input.key.split('/')[1] };
  if (process.env.REPORTER_FUNCTION_RUNTIME === 'true') return workerImageObject(input);
  const endpoint = workerUrl() ?? await transaction('runtime',async db => (await db.query('SELECT public.reporter_object_endpoint() AS endpoint')).rows[0]?.endpoint);
  if (!endpoint || !process.env.REPORTER_WORKER_PASSWORD) throw new FlowError('UPLOAD_CONFIGURATION',503);
  const response = await fetch(endpoint.replace(/\/+$/,'')+'/objects', { method: 'POST',headers: {
    'content-type': 'application/json','x-reporter-worker-key': process.env.REPORTER_WORKER_PASSWORD,
  },body: JSON.stringify(input),signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new FlowError('IMAGE_UNAVAILABLE',503);
  return await response.json() as { url?: string };
}

export async function imageFileUrl(fileKey: string, workspaceId?: string) { return (await gateway({ action: 'read',key: key(fileKey,workspaceId) })).url!; }
export async function prepareImageFile(fileKey: string,mime: string) { return (await gateway({ action: 'prepare',key: key(fileKey),mime })).url!; }
export async function writeImageFile(fileKey: string,bytes: Buffer,mime = 'image/jpeg',workspaceId?:string) {
  if (!imageFileKey.test(fileKey)) throw new FlowError('UNSAFE_STORAGE',500);
  if (reporterDeploymentMode() === 'cloud') {
    await gateway({ action: 'write',key: key(fileKey,workspaceId),mime,bytes: bytes.toString('base64') });return;
  }
  try { await writeFile(join(await storageRoot(),fileKey),bytes,{ mode: 0o600,flag: 'wx' }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
}
export async function readImageFile(fileKey: string, workspaceId?: string) {
  if (!imageFileKey.test(fileKey)) throw new FlowError('UNSAFE_STORAGE',500);
  let bytes: Buffer;
  if (reporterDeploymentMode() === 'cloud') {
    const response = await fetch(await imageFileUrl(fileKey,workspaceId),{signal: AbortSignal.timeout(30000)});
    if (!response.ok || !response.body) throw new FlowError('IMAGE_UNAVAILABLE',422);
    const reader = response.body.getReader(),chunks: Uint8Array[] = [];let size = 0;
    try { for (;;) { const {done,value} = await reader.read();if (done) break;size += value.length;
      if (size > 10*1024**2) { await reader.cancel();throw new FlowError('IMAGE_TOO_LARGE',422); } chunks.push(value);
    } } finally { reader.releaseLock(); }
    bytes = Buffer.concat(chunks);
  } else {
    const path=join(await storageRoot(),fileKey),info=await lstat(path);
    if(!info.isFile()||info.isSymbolicLink()||info.size>10*1024**2)throw new FlowError('IMAGE_UNAVAILABLE',422);
    bytes=await readFile(path);
  }
  if (!bytes.length || bytes.length > 10*1024**2 || createHash('sha256').update(bytes).digest('hex') !== fileKey.slice(0,64)) throw new FlowError('IMAGE_UNAVAILABLE',422);
  return bytes;
}
