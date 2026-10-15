import 'server-only';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { FlowError } from './errors.ts';
import { WORKER_MEDIA, WORKER_MEDIA_BUCKET, workerMediaKey, type MediaTool } from './worker-media-manifest.ts';

const installed = new Map<MediaTool, Promise<string>>();
const client = new S3Client({ forcePathStyle: true });

export async function installWorkerMedia(tool: MediaTool, body: Readable, expected: { size: number; sha256: string } = WORKER_MEDIA[tool]) {
  const directory = await mkdtemp(join(tmpdir(), 'reporter-media-'));
  const destination = join(directory, tool), hash = createHash('sha256');
  let size = 0;
  try {
    await pipeline(body, new Transform({ transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > expected.size) { callback(new FlowError('MEDIA_TOOL_INTEGRITY', 503)); return; }
      hash.update(chunk); callback(null, chunk);
    } }), createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
    if (size !== expected.size || hash.digest('hex') !== expected.sha256) throw new FlowError('MEDIA_TOOL_INTEGRITY', 503);
    await chmod(destination, 0o700);
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
    }).then(object => {
      if (!(object.Body instanceof Readable)) throw new FlowError('MEDIA_TOOL_UNAVAILABLE', 503);
      return installWorkerMedia(tool, object.Body);
    }).catch(() => { installed.delete(tool); throw new FlowError('MEDIA_TOOL_UNAVAILABLE', 503); });
    installed.set(tool, pending);
  }
  return pending;
}
