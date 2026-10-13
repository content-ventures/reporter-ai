import assert from 'node:assert/strict';
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
