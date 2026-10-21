import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultEditorialPolicy, editorialSystemPrompt } from '../src/domain/editorial-policy.ts';
import { defaultPipelineDefinition, pipelineRevision, PIPELINE_SCHEMAS } from '../src/domain/pipeline.ts';
import type { PipelineCall, PipelineVariables } from '../src/domain/pipeline.ts';
import { parsePipelineDefinition } from '../src/server/pipeline.ts';
import { executePipelineStep } from '../src/server/pipeline-runner.ts';

process.env.REPORTER_LOCAL_MODE = 'true';
process.env.GROQ_API_KEY = 'test-placeholder-not-a-real-key';

test('editorial settings validate nested fields, URL schemes and bounded payloads', () => {
  const definition = { ...defaultPipelineDefinition(), editorial: defaultEditorialPolicy() };
  definition.editorial.guide.composition = { headings: 'Use only when the subject changes.' };
  definition.editorial.guide.examples = [{ id: 'reference', title: 'Example', url: 'https://example.org/article', note: 'Specific title.' }];
  assert.deepEqual(parsePipelineDefinition(definition).definition?.editorial, definition.editorial);
  for (const url of ['javascript:alert(1)', 'data:text/plain,article', 'file:///article', 'invalid']) {
    const invalid = structuredClone(definition);
    invalid.editorial.guide.examples[0].url = url;
    assert.match(parsePipelineDefinition(invalid).error ?? '', /mapa e o guia/);
  }
  assert.ok(parsePipelineDefinition({ ...definition, editorial: { ...definition.editorial, hidden: true } }).error);
  const tooLong = structuredClone(definition);
  tooLong.editorial.guide.voice = 'x'.repeat(4001);
  assert.ok(parsePipelineDefinition(tooLong).error);
  const empty = structuredClone(definition);
  empty.editorial.guide.rules.push({ id: 'empty', text: '  ' });
  assert.ok(parsePipelineDefinition(empty).error);
});

test('provider requests and cache keys use the queued editorial policy, never a later edit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reporter-editorial-policy-'));
  const definition = { ...defaultPipelineDefinition(), editorial: defaultEditorialPolicy() };
  definition.editorial.map.audience = 'Seafood professionals';
  definition.editorial.guide.voice = 'Precise guide {{brief}}';
  const snapshot = pipelineRevision(definition, 2);
  const variables: PipelineVariables = { source: '[e1] A sourced fact.', brief: 'Actual brief', sizing: '{}', outline: '{}', section: '', history: '', futureSections: '', layouts: '', approvedArticle: '', event: '', people: '' };
  const requests: { messages: { role: string; content: string }[] }[] = [];
  const traces: PipelineCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ id: 'fixture', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ title: 'A title', introIds: [], sections: [{ title: 'A section', evidenceIds: ['e1'] }] }) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
  };
  try {
    const input = { pipeline: snapshot, key: 'outline' as const, variables, schema: PIPELINE_SCHEMAS.outline, directory,
      signal: new AbortController().signal, trace: async (call: PipelineCall) => { traces.push(call); } };
    await executePipelineStep(input);
    definition.editorial.guide.voice = 'Revised guide';
    await executePipelineStep(input);
    assert.equal(requests.length, 1);
    assert.equal(traces.at(-1)?.cached, true);
    assert.equal(requests[0].messages[0].content, editorialSystemPrompt(snapshot.definition.systemPrompt, snapshot.definition.editorial, 'outline'));
    assert.ok(requests[0].messages[0].content.includes('{{brief}}'));
    await executePipelineStep({ ...input, pipeline: pipelineRevision(definition, 3) });
    assert.equal(requests.length, 2);
    assert.ok(requests[1].messages[0].content.includes('Revised guide'));
    assert.notEqual(traces[0].hash, traces.at(-1)?.hash);
  } finally {
    globalThis.fetch = original;
    await rm(directory, { recursive: true, force: true });
  }
});
