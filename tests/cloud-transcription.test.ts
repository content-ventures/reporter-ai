import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { audioChunks } from '../src/domain/reporter.ts';
import { processTranscript } from '../src/server/reporter-worker-jobs.ts';
import { installWorkerMedia } from '../src/server/worker-media.ts';
import { transcriptionModel } from '../src/server/groq.ts';

test('406 MiB cloud media is transcribed in bounded overlapping chunks and a retry reuses completed parts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reporter-cloud-chunks-'));
  const source = 'https://storage.test/private.mp4?signature=opaque';
  let prepared = 0, transcribed = 0;
  const services = {
    withCloudMediaSource: async <T>(_url: string, _signal: AbortSignal, operation: (source: string) => Promise<T>) => operation(source),
    signedSourceUrl: async () => source,
    verifySource: async () => { throw new Error('Cloud media must not use local source storage.'); },
    inspectMedia: async (url: string, _signal?: AbortSignal, remote?: boolean) => {
      assert.equal(url, source); assert.equal(remote, true); return { duration: 1300, contentType: 'video/mp4' };
    },
    prepareChunk: async (url: string, destination: string, start: number, duration: number, _signal: AbortSignal, remote?: boolean) => {
      assert.equal(url, source); assert.equal(remote, true);
      const expected = audioChunks(1300)[prepared++];
      assert.deepEqual({ start, duration }, { start: expected.start, duration: expected.duration });
      await writeFile(destination, 'synthetic small FLAC');
    },
    transcribeChunk: async () => ({ provider: 'groq', model: transcriptionModel(), provider_request_id: null,
      usage_unit: 'audio_ms' as const, input_units: 1000, output_units: null, content: `Part ${++transcribed}`, segments: null }),
  };
  const phases: string[] = [];
  try {
    const input = { provider: 's3', bucket: 'reporter-source-media', key: 'incoming/source.mp4',
      size: 406 * 1024 ** 2, content_type: 'video/mp4', language: 'pt-BR' };
    const run = () => processTranscript(input, directory, new AbortController().signal, async phase => { phases.push(phase); }, services);
    assert.equal((await run()).content, 'Part 1\n\nPart 2\n\nPart 3');
    assert.equal((await run()).content, 'Part 1\n\nPart 2\n\nPart 3');
    assert.equal(prepared, 3); assert.equal(transcribed, 3);
    assert.equal(phases[0], 'preparing');
    await assert.rejects(stat(join(directory, 'chunk-0.flac')), { code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('cloud chunks are removed when a provider rejects the recording', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reporter-cloud-failure-'));
  try {
    await assert.rejects(processTranscript({ provider: 's3', bucket: 'reporter-source-media', key: 'incoming/a.mp4',
      size: 406 * 1024 ** 2, content_type: 'video/mp4', language: 'pt-BR' }, directory,
    new AbortController().signal, async () => {}, {
      withCloudMediaSource: async <T>(url: string, _signal: AbortSignal, operation: (source: string) => Promise<T>) => operation(url),
      signedSourceUrl: async () => 'https://storage.test/a.mp4', verifySource: async () => '',
      inspectMedia: async () => ({ duration: 10, contentType: 'video/mp4' }),
      prepareChunk: async (_url, destination) => { await writeFile(destination, 'test'); },
      transcribeChunk: async () => { throw new Error('provider unavailable'); },
    }), /provider unavailable/);
    await assert.rejects(stat(join(directory, 'chunk-0.flac')), { code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('worker media is executable only after its exact length and SHA256 are verified', async () => {
  const bytes = Buffer.from('synthetic executable');
  const expected = { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  const path = await installWorkerMedia('ffmpeg', Readable.from([bytes]), expected);
  try {
    assert.deepEqual(await readFile(path), bytes); assert.equal((await stat(path)).mode & 0o777, 0o700);
  } finally { await rm(dirname(path), { recursive: true, force: true }); }
  for (const body of [Buffer.from('corrupted executable'), Buffer.alloc(100), Buffer.alloc(0)]) {
    await assert.rejects(installWorkerMedia('ffmpeg', Readable.from([body]), expected), /MEDIA_TOOL_INTEGRITY/);
  }
});
