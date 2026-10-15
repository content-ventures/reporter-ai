import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { WORKER_MEDIA, WORKER_MEDIA_BUCKET, workerMediaKey } from '../src/server/worker-media-manifest.ts';

export function verifyMediaBinary(tool, bytes) {
  const expected = WORKER_MEDIA[tool];
  if (bytes.length !== expected.size || createHash('sha256').update(bytes).digest('hex') !== expected.sha256
    || bytes.subarray(0, 4).toString('binary') !== '\x7fELF' || bytes.readUInt16LE(18) !== 183) {
    throw new Error(`Invalid Linux ARM64 ${tool} binary.`);
  }
}

export async function provisionWorkerMedia({ checkOnly = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'reporter-worker-media-'));
  const client = new S3Client({ forcePathStyle: true });
  try {
    for (const tool of ['ffmpeg', 'ffprobe']) {
      const expected = WORKER_MEDIA[tool];
      const response = await fetch(expected.archive, { signal: AbortSignal.timeout(90_000) });
      if (!response.ok) throw new Error(`Could not download the pinned ${tool} distribution (HTTP ${response.status}).`);
      const archive = Buffer.from(await response.arrayBuffer());
      if (createHash('sha512').update(archive).digest('base64') !== expected.integrity) {
        throw new Error(`The pinned ${tool} archive failed its integrity check.`);
      }
      const path = join(directory, `${tool}.tgz`);
      await writeFile(path, archive, { mode: 0o600 });
      execFileSync('tar', ['-xzf', path, '-C', directory, '--strip-components=1', `package/${tool}`], { stdio: 'pipe' });
      const bytes = await readFile(join(directory, tool));
      verifyMediaBinary(tool, bytes);
      if (!checkOnly) await client.send(new PutObjectCommand({
        Bucket: WORKER_MEDIA_BUCKET, Key: workerMediaKey(tool), Body: bytes,
        ContentType: 'application/octet-stream', Metadata: { sha256: expected.sha256 },
      }), { abortSignal: AbortSignal.timeout(90_000) });
      console.log(`${tool}: pinned Linux ARM64 binary ${checkOnly ? 'verified' : 'provisioned'}.`);
    }
  } finally { client.destroy(); await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await provisionWorkerMedia({ checkOnly: process.argv.includes('--check') });
}
