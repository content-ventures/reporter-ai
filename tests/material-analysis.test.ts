import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { materialSample, validateMaterialInsights, runMaterialAnalysis } from '../src/server/material-analysis.ts';
import { parseTranscript } from '../src/domain/text/transcript-parse.ts';
import { defaultPipelineDefinition, pipelineRevision } from '../src/domain/pipeline.ts';

process.env.REPORTER_LOCAL_MODE = 'true';
process.env.GROQ_API_KEY = 'test-placeholder-not-a-real-key';
const text = 'Eu sou Marina Costa, editora da Oficina Local. Hoje vamos discutir oficinas de leitura em bibliotecas.';
const segments = parseTranscript(text).segments;
const participant = { name: 'Marina Costa', title: 'editora', organization: 'Oficina Local', segmentId: segments[0].id, excerpt: segments[0].text };
const insights = { title: 'Oficinas de leitura em bibliotecas', participants: [participant] };

test('metadata retains literal presentations, rejects invented names and leaves unlabeled speech untouched', () => {
  const value = validateMaterialInsights({ ...insights, participants: [participant, participant,
    { ...participant, name: 'Pedro Silva' }, { ...participant, segmentId: 'missing' },
    { ...participant, name: 'Oficina Local', title: 'CEO', organization: 'Empresa inventada' }] }, segments);
  assert.equal(value.participants.length, 2);
  assert.equal(value.participants[1].title, '');
  assert.equal(value.participants[1].organization, '');
  assert.equal(segments[0].speaker, undefined);
  assert.throws(() => validateMaterialInsights({ title: '', participants: [] }, segments), /MATERIAL_ANALYSIS_INVALID/);
});
test('long-source metadata includes opening, middle and ending within a bounded sample', () => {
  const long = Array.from({ length: 150 }, (_, index) => ({ id: 'seg-' + index, text: String(index) + ' conteúdo'.repeat(45) }));
  const sample = materialSample(long);
  assert.ok(sample.some(segment => segment.id === 'seg-0'));
  assert.ok(sample.some(segment => segment.id === 'seg-149'));
  assert.ok(sample.some(segment => Number(segment.id.slice(4)) >= 65 && Number(segment.id.slice(4)) <= 85));
  assert.ok(sample.reduce((total, segment) => total + segment.text.length + segment.id.length + 16, 0) <= 10000);
  assert.ok(sample.length < long.length);
});
test('materialSample takes the opening of every part', () => {
  const untagged = Array.from({ length: 120 }, (_, index) => ({ id: 'seg-' + index, text: String(index) + ' conteúdo'.repeat(100) }));
  const tagged = untagged.map((segment, index) => ({ ...segment, part: Math.floor(index / 40) + 1 }));
  const sampled = (segments: typeof untagged) => materialSample(segments).map(segment => segment.id);
  assert.ok(!sampled(untagged).includes('seg-40') && !sampled(untagged).includes('seg-80'), 'a single file keeps its sample');
  for (const id of ['seg-0', 'seg-40', 'seg-80', 'seg-119']) assert.ok(sampled(tagged).includes(id), id);
  for (const [parts, chars] of [[6, 1180], [10, 300]]) {
    const many = Array.from({ length: parts * 20 }, (_, index) => ({ id: 'seg-' + index, text: 'x'.repeat(chars), part: Math.floor(index / 20) + 1 }));
    const sample = materialSample(many);
    for (let part = 0; part < parts; part++) assert.ok(sample.some(segment => segment.id === 'seg-' + part * 20), `${parts} partes: parte ${part + 1}`);
    assert.ok(sample.reduce((total, segment) => total + segment.text.length + segment.id.length + 16, 0) <= 10000);
  }
});
test('material uses the exact saved prompts; concurrent reads share one request and edited prompts invalidate cache', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reporter-material-test-'));
  const original = globalThis.fetch, requests: { messages: { content: string }[] }[] = [];
  const definition = defaultPipelineDefinition();
  definition.systemPrompt = 'Sistema salvo sem prefixo.';
  definition.steps.material.prompt = 'Prompt salvo: {{source}}';
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(insights) } }] });
  };
  try {
    const pipeline = pipelineRevision(definition, 10);
    const [first, second] = await Promise.all([runMaterialAnalysis(text, {}, pipeline, directory), runMaterialAnalysis(text, {}, pipeline, directory)]);
    assert.deepEqual(first, second); assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].messages.map(message => message.content), [definition.systemPrompt, 'Prompt salvo: [' + segments[0].id + '] ' + text]);
    await runMaterialAnalysis(text, {}, pipeline, directory); assert.equal(requests.length, 1);
    definition.steps.material.prompt += '\nAlterado';
    await runMaterialAnalysis(text, {}, pipelineRevision(definition, 11), directory); assert.equal(requests.length, 2);
    assert.equal(first.pipelineRevision, 10);
  } finally { globalThis.fetch = original; await rm(directory, { recursive: true, force: true }); }
});
test('invalid material output is not cached, so a later valid response can recover', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reporter-material-retry-'));
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(++calls === 1 ? { title: '', participants: [] } : insights) } }] });
  try {
    const pipeline = pipelineRevision(defaultPipelineDefinition());
    await assert.rejects(runMaterialAnalysis(text, {}, pipeline, directory), /MATERIAL_ANALYSIS_INVALID/);
    assert.equal((await runMaterialAnalysis(text, {}, pipeline, directory)).title, insights.title);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; await rm(directory, { recursive: true, force: true }); }
});
