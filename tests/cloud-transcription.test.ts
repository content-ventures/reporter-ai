import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { audioChunks } from '../src/domain/reporter.ts';
import { processTranscript } from '../src/server/reporter-worker-jobs.ts';
import { runMedia } from '../src/server/media.ts';
import { transcriptionModel } from '../src/server/groq.ts';
import { FlowError } from '../src/server/errors.ts';

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

test('a later invocation resumes stored chunks and hands the job back before the budget ends', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reporter-cloud-resume-'));
  const [first, second] = audioChunks(1300);
  const part = (content: string, model = transcriptionModel()) => ({ provider: 'groq', model, provider_request_id: null,
    usage_unit: 'audio_ms' as const, input_units: 1000, output_units: null, content, segments: null });
  const saved: number[] = [];
  let transcribed = 0;
  const store = (chunks: [number, { start_ms: number; duration_ms: number; result: ReturnType<typeof part> }][]) => ({
    read: async () => new Map(chunks), save: async (index: number) => { saved.push(index); },
  });
  const services = {
    withCloudMediaSource: async <T>(url: string, _signal: AbortSignal, operation: (source: string) => Promise<T>) => operation(url),
    signedSourceUrl: async () => 'https://storage.test/a.mp4', verifySource: async () => '',
    inspectMedia: async () => ({ duration: 1300, contentType: 'video/mp4' }),
    prepareChunk: async (_url: string, destination: string) => { await writeFile(destination, 'test'); },
    transcribeChunk: async () => part(`New ${++transcribed}`),
  };
  const input = { provider: 's3', bucket: 'reporter-source-media', key: 'incoming/a.mp4', size: 1, content_type: 'video/mp4', language: 'pt-BR' };
  const exact = { start_ms: Math.round(first.start * 1000), duration_ms: Math.round(first.duration * 1000) };
  try {
    await assert.rejects(processTranscript(input, directory, new AbortController().signal, async () => {}, services,
      { store: store([[0, { ...exact, result: part('Stored 1') }]]), deadline: 1_000_000 + 60_000, now: () => 1_000_000 }), /BUDGET_YIELD/);
    assert.equal(transcribed, 0, 'stored audio is reused and no new chunk starts inside the yield margin');
    const done = await processTranscript(input, directory, new AbortController().signal, async () => {}, services, {
      store: store([[0, { ...exact, result: part('Stored 1') }],
        [1, { start_ms: Math.round(second.start * 1000) + 1, duration_ms: Math.round(second.duration * 1000), result: part('Shifted') }],
        [2, { start_ms: 0, duration_ms: 1, result: part('Old model', 'whisper-old') }]]) });
    assert.equal(done.content, 'Stored 1\n\nNew 1\n\nNew 2', 'a shifted window or another model is transcribed again');
    assert.deepEqual(saved, [1, 2]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a garbled stretch is transcribed again with word timestamps; a failed or doubtful repair keeps the original', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reporter-repair-'));
  const garbled = 'Ent eu trouxe alguns panoramas como por exemplo compara com outras esp su aves e tamb salmonicultura de quanto n estamos';
  const fine = 'A gente tem o município que mais produz tilápias no Brasil.';
  const windows: { start: number; duration: number }[] = [];
  let repairs = 0;
  const make = (repairText: string | null) => ({
    withCloudMediaSource: async <T>(url: string, _signal: AbortSignal, operation: (source: string) => Promise<T>) => operation(url),
    signedSourceUrl: async () => 'https://storage.test/a.ogg', verifySource: async () => '',
    inspectMedia: async () => ({ duration: 30, contentType: 'audio/ogg' }),
    prepareChunk: async (_url: string, destination: string, start: number, duration: number) => {
      if (basename(destination).startsWith('repair-')) windows.push({ start, duration });
      await writeFile(destination, 'test');
    },
    transcribeChunk: async () => ({ provider: 'groq', model: transcriptionModel(), provider_request_id: null, usage_unit: 'audio_ms' as const,
      input_units: 30_000, output_units: null, content: `${fine} ${garbled}`,
      segments: [{ start_ms: 0, end_ms: 4000, text: fine }, { start_ms: 10_000, end_ms: 20_000, text: garbled }] }),
    transcribeWindow: async () => {
      repairs++;
      if (repairText === null) throw new Error('provider unavailable');
      // Relative to the window that starts 3 s before the segment: words between 3 s and 13 s are inside it.
      const words = repairText.split(' ').map((word, at) => ({ word, start_ms: 3200 + at * 400, end_ms: 3500 + at * 400 }));
      return { words: [{ word: 'prazo.', start_ms: 1000, end_ms: 1400 }, ...words], input_units: 16_000, provider_request_id: null };
    },
  });
  const input = { provider: 's3', bucket: 'reporter-source-media', key: 'incoming/a.ogg', size: 1, content_type: 'audio/ogg', language: 'pt-BR' };
  const repaired = 'Então eu trouxe alguns panoramas, como por exemplo, comparação com outras espécies, suínos, aves e também salmonicultura, de quanto nós estamos';
  try {
    const done = await processTranscript(input, directory, new AbortController().signal, async () => {}, make(repaired));
    assert.deepEqual(windows, [{ start: 7, duration: 16 }], 'only the garbled segment, with a 3 s margin');
    assert.equal(done.segments?.[1].text, repaired);
    assert.equal(done.segments?.[0].text, fine);
    assert.equal(done.content, `${fine} ${repaired}`);
    assert.equal(done.input_units, 46_000, 'the repair audio is counted');
    await assert.rejects(stat(join(directory, 'repair-1.flac')), { code: 'ENOENT' });

    const failed = await processTranscript(input, directory, new AbortController().signal, async () => {}, make(null));
    assert.equal(failed.segments?.[1].text, garbled, 'a provider failure never fails the transcript');
    const doubtful = await processTranscript(input, directory, new AbortController().signal, async () => {}, make(garbled));
    assert.equal(doubtful.segments?.[1].text, garbled, 'the same failure again is not a repair');
    assert.equal(repairs, 3);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a rate-limited repair waits once and retries; a second limit leaves the remaining repairs out', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reporter-repair-limit-'));
  const garbled = 'Ent eu trouxe alguns panoramas como por exemplo compara com outras esp su aves e tamb salmonicultura de quanto n estamos';
  const repaired = 'Então eu trouxe alguns panoramas, como por exemplo, comparação com outras espécies, suínos, aves e também salmonicultura, de quanto nós estamos';
  const waits: number[] = [];
  let calls = 0;
  const services = (limitEvery: boolean) => ({
    withCloudMediaSource: async <T>(url: string, _signal: AbortSignal, operation: (source: string) => Promise<T>) => operation(url),
    signedSourceUrl: async () => 'https://storage.test/a.ogg', verifySource: async () => '',
    inspectMedia: async () => ({ duration: 60, contentType: 'audio/ogg' }),
    prepareChunk: async (_url: string, destination: string) => { await writeFile(destination, 'test'); },
    transcribeChunk: async () => ({ provider: 'groq', model: transcriptionModel(), provider_request_id: null, usage_unit: 'audio_ms' as const,
      input_units: 60_000, output_units: null, content: `${garbled} ${garbled}`,
      segments: [{ start_ms: 10_000, end_ms: 20_000, text: garbled }, { start_ms: 30_000, end_ms: 40_000, text: garbled }] }),
    transcribeWindow: async () => {
      calls++;
      if (limitEvery || calls === 1) throw new FlowError('GROQ_RATE_LIMIT', 502, true, 5);
      return { words: repaired.split(' ').map((word, at) => ({ word, start_ms: at * 300, end_ms: at * 300 + 250 })), input_units: 16_000, provider_request_id: null };
    },
    wait: async (ms: number) => { waits.push(ms); },
  });
  const input = { provider: 's3', bucket: 'reporter-source-media', key: 'incoming/a.ogg', size: 1, content_type: 'audio/ogg', language: 'pt-BR' };
  try {
    const done = await processTranscript(input, directory, new AbortController().signal, async () => {}, services(false));
    assert.deepEqual(waits, [5000]);
    assert.deepEqual(done.segments?.map(segment => segment.text), [repaired, repaired]);
    calls = 0; waits.length = 0;
    const limited = await processTranscript(input, directory, new AbortController().signal, async () => {}, services(true));
    assert.deepEqual(waits, [5000], 'one wait per recording');
    assert.equal(calls, 2, 'after the second limit no further repair is sent');
    assert.deepEqual(limited.segments?.map(segment => segment.text), [garbled, garbled], 'the transcript completes with the original text');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
