import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { audioChunks } from '../src/domain/reporter.ts';
import { processTranscript } from '../src/server/reporter-worker-jobs.ts';
import { runMedia } from '../src/server/media.ts';
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

test('media execution identifies missing and non-executable tools without exposing their paths',async () => {
  const directory = await mkdtemp(join(tmpdir(),'reporter-media-exec-'));
  try {
    await assert.rejects(runMedia(join(directory,'missing'),['-version']),/MEDIA_TOOL_EXEC_ENOENT/);
    const path = join(directory,'not-executable'); await writeFile(path,'private test content',{mode:0o600});
    await assert.rejects(runMedia(path,['-version']),/MEDIA_TOOL_EXEC_EACCES/);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
