import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { test } from 'node:test';
import { createHttpIngest } from '../src/adapters/http/reporter-client.ts';
import { parseTranscript, analyzeTranscript, sourceContentHash } from '../src/domain/index.ts';
import { ok, refuse } from '../src/domain/result.ts';
import type { SourceIngest, SourceAnalysis } from '../src/ports/source-ingest.ts';

const text = 'Eu sou Marina Costa. Nosso assunto é organizar oficinas de leitura.';
const parsed = parseTranscript(text), stats = analyzeTranscript(parsed.segments);
const analysis: SourceAnalysis = { format: parsed.format, hash: sourceContentHash({ type: 'transcript', format: parsed.format, segments: parsed.segments }),
  segments: parsed.segments, speakers: stats.speakers, stats: { ...stats, characters: text.length }, preview: parsed.segments,
  warnings: parsed.warnings, short: true };
const local: SourceIngest = { limits: { extensions: ['.txt'], maxBytes: 1048576, shortWords: 300 },
  read: async () => refuse('read_failed', 'Arquivo ausente'), readLink: async () => refuse('read_failed','Link ausente'),
  analyze: async () => ok(structuredClone(analysis)) };

test('connected analysis shows presented people without attributing or changing transcript segments', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ title: 'Oficinas de leitura', pipelineRevision: 11, participants: [
    { name: 'Marina Costa', title: '', organization: '', segmentId: parsed.segments[0].id, excerpt: 'Eu sou Marina Costa.' },
  ] });
  try {
    const result = await createHttpIngest(local).analyze(text);
    assert.ok(result.ok); assert.equal(result.value.topicTitle, 'Oficinas de leitura');
    assert.equal(result.value.speakers[0].label, 'Marina Costa'); assert.equal(result.value.speakers[0].segments, 0);
    assert.equal(result.value.speakers[0].presentation?.excerpt, 'Eu sou Marina Costa.');
    assert.deepEqual(result.value.segments, analysis.segments); assert.equal(result.value.hash, analysis.hash);
  } finally { globalThis.fetch = original; }
});
test('metadata failures return a recoverable refusal rather than silently advancing without participants', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ message: 'Limite temporário. Tente novamente.' }, { status: 502 });
  try {
    const result = await createHttpIngest(local).analyze(text);
    assert.equal(result.ok, false);
    if (!result.ok) { assert.equal(result.refusal.code, 'analysis_failed'); assert.equal(result.refusal.message, 'Limite temporário. Tente novamente.'); }
  } finally { globalThis.fetch = original; }
});

test('large media uploads bypass the Next body through bounded presigned parts and then poll the transcript',async () => {
  const original = globalThis.fetch;
  const calls: string[] = [],uploaded: number[] = [],progress: number[] = [];
  globalThis.fetch = async (input,init) => {
    const url = String(input);calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url==='/api/reporter/uploads') return Response.json({ mode: 'cloud',id: 'transcript-1',
      source_id: '550e8400-e29b-41d4-a716-446655440000',upload_endpoint: 'https://worker.test' },{ status: 202 });
    if (url==='https://worker.test/uploads/start') return Response.json({ partSize: 5*1024**2,size: 6*1024**2,
      parts: [{ number: 1,url: 'https://storage.test/part-1' },{ number: 2,url: 'https://storage.test/part-2' }] });
    if (url.startsWith('https://storage.test/part-')) {
      uploaded.push((init?.body as Blob).size);return new Response(null,{ status: 200 });
    }
    if (url==='https://worker.test/uploads/complete') return Response.json({ accepted: true });
    if (url==='/api/reporter/transcripts/transcript-1') return Response.json({ worker_online: true,transcript: {
      id: 'transcript-1',revision: 1,status: 'ready',file_name: 'podcast.mp3',content: 'Transcrição pronta.',
      segments: null,error_code: null,source_object_id: '550e8400-e29b-41d4-a716-446655440000',
    } });
    throw new Error('Unexpected request '+url);
  };
  try {
    const media = new File([new Uint8Array(6*1024**2)],'podcast.mp3',{ type: 'audio/mpeg' });
    const result = await createHttpIngest(local).read(media,{ onProgress: value => progress.push(value) });
    assert.ok(result.ok);
    if (result.ok) { assert.equal(result.value.text,'Transcrição pronta.');assert.equal(result.value.transcriptId,'transcript-1'); }
    assert.deepEqual(uploaded.sort((a,b) => b-a),[5*1024**2,1024**2]);
    assert.equal(calls.some(call => call.includes('/api/reporter/files')),false);
    assert.ok(progress.some(value => value>=80));assert.equal(progress.at(-1),100);
  } finally { globalThis.fetch = original; }
});
