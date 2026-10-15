import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { audioChunks } from '../src/domain/reporter.ts';
import { processTranscript } from '../src/server/reporter-worker-jobs.ts';
import { installWorkerMedia, workerMediaFailure, workerMediaStream } from '../src/server/worker-media.ts';
import { runMedia } from '../src/server/media.ts';
import { FlowError } from '../src/server/errors.ts';
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

test('media installation consumes hosted async streams without a Node Readable identity', async () => {
  const bytes = Buffer.from('verified streamed bytes');
  const expected = { size: bytes.length,sha256: createHash('sha256').update(bytes).digest('hex') };
  const hosted = { async *[Symbol.asyncIterator]() { yield bytes.subarray(0,5); yield bytes.subarray(5); } };
  assert.equal(hosted instanceof Readable,false);
  const web = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });
  for (const body of [hosted,web]) {
    const path = await installWorkerMedia('ffmpeg',workerMediaStream(body),expected);
    try { assert.deepEqual(await readFile(path),bytes); }
    finally { await rm(dirname(path),{recursive:true,force:true}); }
  }
  for (const body of [undefined,null,'private-provider-detail',{}]) {
    assert.throws(() => workerMediaStream(body),/MEDIA_TOOL_BODY_UNAVAILABLE/);
  }
});

test('media diagnostics preserve integrity and separate storage, download and filesystem failures', () => {
  const integrity = new FlowError('MEDIA_TOOL_INTEGRITY',503);
  assert.equal(workerMediaFailure(integrity),integrity);
  for (const [failure,expected] of [
    [{name:'AccessDenied'},'MEDIA_TOOL_STORAGE_DENIED'],
    [{name:'NoSuchKey'},'MEDIA_TOOL_OBJECT_MISSING'],
    [{name:'TimeoutError'},'MEDIA_TOOL_DOWNLOAD_TIMEOUT'],
    [{code:'EACCES'},'MEDIA_TOOL_FILESYSTEM_EACCES'],
    [{message:'private-provider-detail'},'MEDIA_TOOL_DOWNLOAD_FAILED'],
  ] as const) {
    assert.equal(workerMediaFailure(failure).code,expected);
    assert.equal(workerMediaFailure(failure).status,503);
  }
});

test('media execution identifies missing and non-executable tools without exposing their paths',async () => {
  const directory = await mkdtemp(join(tmpdir(),'reporter-media-exec-'));
  try {
    await assert.rejects(runMedia(join(directory,'missing'),['-version']),/MEDIA_TOOL_EXEC_ENOENT/);
    const path = join(directory,'not-executable'); await writeFile(path,'private test content',{mode:0o600});
    await assert.rejects(runMedia(path,['-version']),/MEDIA_TOOL_EXEC_EACCES/);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
