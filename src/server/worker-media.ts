import 'server-only';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { FlowError } from './errors.ts';
import { WORKER_MEDIA, WORKER_MEDIA_BUCKET, workerMediaKey, type MediaTool } from './worker-media-manifest.ts';

const installed = new Map<MediaTool, Promise<string>>();
const client = new S3Client({ forcePathStyle: true });

/** Only fixed runtime paths and modes; never include storage URLs or user data. */
export async function workerMediaDiagnostics(){
  const root=process.env.REPORTER_FUNCTION_RUNTIME==='true'?'/run':tmpdir();
  const mounts=await readFile('/proc/mounts','utf8').catch(()=>'');
  const mount=mounts.split('\n').map(line=>line.split(' ')).filter(parts=>parts[1]==='/'||parts[1]===root).map(parts=>({point:parts[1],options:parts[3]?.split(',').filter(option=>['rw','ro','noexec','exec','nosuid','nodev'].includes(option))}));
  const tools=[];
  for(const[tool,pending]of installed){try{const path=await pending,info=await stat(path);tools.push({tool,mode:info.mode&0o777,bytes:info.size});}catch{/* The bounded failure code covers failed installation. */}}
  return {root,mount,tools,platform:process.platform,arch:process.arch};
}

export function workerMediaStream(body: unknown): Readable {
  const stream = body as (Partial<AsyncIterable<Uint8Array>> & { transformToWebStream?(): ReadableStream<Uint8Array> }) | undefined;
  if (stream && typeof stream === 'object') {
    if (typeof stream[Symbol.asyncIterator] === 'function') return Readable.from(stream as AsyncIterable<Uint8Array>);
    if (typeof stream.transformToWebStream === 'function') return Readable.fromWeb(stream.transformToWebStream());
  }
  // S3 can expose a host-provided stream. Consume the async-iterator contract
  // rather than relying on the Node Readable constructor's identity.
  throw new FlowError('MEDIA_TOOL_BODY_UNAVAILABLE', 503);
}

export function workerMediaFailure(error: unknown): FlowError {
  if (error instanceof FlowError) return error;
  const failure = error as { name?: string; code?: string; $metadata?: { httpStatusCode?: number } } | null;
  if (failure?.$metadata?.httpStatusCode === 403 || ['AccessDenied','InvalidAccessKeyId','SignatureDoesNotMatch','ExpiredToken'].includes(failure?.name ?? '')) {
    return new FlowError('MEDIA_TOOL_STORAGE_DENIED', 503);
  }
  if (failure?.$metadata?.httpStatusCode === 404 || ['NoSuchKey','NotFound','NoSuchBucket'].includes(failure?.name ?? '')) return new FlowError('MEDIA_TOOL_OBJECT_MISSING', 503);
  if (['AbortError','TimeoutError'].includes(failure?.name ?? '')) return new FlowError('MEDIA_TOOL_DOWNLOAD_TIMEOUT', 503);
  if (['EACCES','EPERM','EROFS','ENOSPC','ENOSYS'].includes(failure?.code ?? '')) {
    return new FlowError(`MEDIA_TOOL_FILESYSTEM_${failure!.code}`, 503);
  }
  return new FlowError('MEDIA_TOOL_DOWNLOAD_FAILED', 503);
}

export async function installWorkerMedia(tool: MediaTool, body: Readable, expected: { size: number; sha256: string } = WORKER_MEDIA[tool]) {
  // Neon mounts /tmp with noexec. Keep executable bytes in its exec-enabled
  // /run tmpfs; media inputs and scratch data can still use /tmp.
  const root = process.env.REPORTER_FUNCTION_RUNTIME === 'true' ? '/run' : tmpdir();
  const directory = await mkdtemp(join(root, 'reporter-media-'));
  const destination = join(directory, tool), hash = createHash('sha256');
  let size = 0;
  try {
    await pipeline(body, new Transform({ transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > expected.size) { callback(new FlowError('MEDIA_TOOL_INTEGRITY', 503)); return; }
      hash.update(chunk); callback(null, chunk);
    } }), createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
    if (size !== expected.size || hash.digest('hex') !== expected.sha256) throw new FlowError('MEDIA_TOOL_INTEGRITY', 503);
    // The runtime's executable launcher must be able to traverse the directory.
    // These are public, pinned tool bytes; inputs and credentials never live here.
    const mode=process.env.REPORTER_FUNCTION_RUNTIME==='true'?0o755:0o700;
    await chmod(directory,mode);await chmod(destination,mode);
    return destination;
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}

export function mediaExecutable(tool: MediaTool): Promise<string> {
  const configured = process.env[tool === 'ffmpeg' ? 'REPORTER_FFMPEG' : 'REPORTER_FFPROBE'];
  if (configured) return Promise.resolve(configured);
  if (process.env.REPORTER_FUNCTION_RUNTIME !== 'true') return Promise.resolve(tool);
  let pending = installed.get(tool);
  if (!pending) {
    pending = client.send(new GetObjectCommand({ Bucket: WORKER_MEDIA_BUCKET, Key: workerMediaKey(tool) }), {
      abortSignal: AbortSignal.timeout(90_000),
    }).then(object => installWorkerMedia(tool, workerMediaStream(object.Body)))
      .catch(error => { installed.delete(tool); throw workerMediaFailure(error); });
    installed.set(tool, pending);
  }
  return pending;
}
