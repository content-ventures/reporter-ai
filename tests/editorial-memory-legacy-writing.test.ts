import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryWritingFixture } from '../src/domain/testing/editorial-memory.ts';
import { baseRecord, createKit } from '../src/domain/testing/scenario.ts';
import { editorialCandidates } from '../src/runtime/editorial-engine.ts';
import { defaultPipelineDefinition, pipelineRevision, PIPELINE_SCHEMAS, type PipelineVariables } from '../src/domain/pipeline.ts';
import { writingSource } from '../src/domain/evidence-hints.ts';
import { restoreLiteralQuoteCase, writingContractIssue } from '../src/server/pipeline-output.ts';
import { executePipelineStep, writeCompleteArticle, writeSequentialArticle } from '../src/server/pipeline-runner.ts';
import { cacheRead } from '../src/server/storage.ts';

let n = 0;
const datum = 'Foram atendidas cerca de 240 pessoas em 2025. Apenas participantes do projeto piloto foram incluídos.';
function fixture(kind: 'statistic' | 'citation' = 'statistic', text = datum) {
  const bank = memoryWritingFixture(kind, text, { now: '2026-10-28T20:00:00Z', actorId: 'actor', newId: prefix => prefix + '-' + (++n) });
  const record = baseRecord(createKit()), candidates = editorialCandidates({ ...record, sources: [bank.source] }), candidate = candidates[0];
  const evidence = new Map([[candidate.key, candidate.text], ['ordinary', 'Contexto editorial sintético completo.']]);
  const memory = { sources: [bank.source], references: new Map([[candidate.key, candidate.ref]]) };
  const paragraph = (value: string) => ({ text: value, evidenceIds: [candidate.key] });
  const ordinary = { text: evidence.get('ordinary')!, evidenceIds: ['ordinary'] };
  const outline = { title: 'Pauta sintética', introIds: [candidate.key], sections: [{ title: 'Seção sintética', evidenceIds: ['ordinary'] }] };
  const variables: PipelineVariables = { source: writingSource('Context', candidates, new Set([candidate.key]), new Map()), brief: '{}', sizing: '{}', outline: '{}',
    section: '', history: '', futureSections: '', layouts: '', approvedArticle: '', event: '', people: '' };
  return { ...bank, candidates, candidate, evidence, memory, paragraph, ordinary, outline, variables };
}
test('legacy single and sequential contracts reject incomplete observations and statistical speech', () => {
  const f = fixture(), contract = { evidence: f.evidence, memory: f.memory };
  for (const text of [datum.replace('cerca de ', ''), datum.replace('2025', '2026'), datum.replace('pessoas', 'empresas'), datum.slice(0, datum.indexOf('.') + 1), '“' + datum + '”']) {
    const paragraph = f.paragraph(text);
    assert.equal(writingContractIssue('intro', { paragraphs: [paragraph] }, contract), 'MEMORY_LITERAL_CHANGED');
    assert.equal(writingContractIssue('section', { title: 'Seção sintética', paragraphs: [paragraph] }, contract), 'MEMORY_LITERAL_CHANGED');
    assert.equal(writingContractIssue('article', { title: 'Pauta sintética', intro: [paragraph], sections: [{ title: 'Seção sintética', paragraphs: [f.ordinary] }] }, contract), 'MEMORY_LITERAL_CHANGED');
  }
  assert.equal(writingContractIssue('intro', { paragraphs: [f.paragraph(datum)] }, contract), undefined);
});
test('legacy citation fragments preserve exact original whitespace rather than normalized quotation text', () => {
  const text = 'Queremos  ouvir\n todas as pessoas neste exemplo sintético.', f = fixture('citation', text), fragment = text.slice(9, -1);
  const value = { paragraphs: [f.paragraph('“' + fragment + '”.')] }, contract = { evidence: f.evidence, memory: f.memory };
  assert.equal(writingContractIssue('intro', value, contract), undefined);
  value.paragraphs[0].text = '“' + fragment.replace(/\s+/g, ' ') + '”.';
  assert.equal(writingContractIssue('intro', value, contract), 'MEMORY_LITERAL_CHANGED');
  const changed = { paragraphs: [f.paragraph('“' + text.replace('Queremos', 'queremos') + '”')] };
  assert.deepEqual(restoreLiteralQuoteCase('intro', changed, f.evidence, undefined, new Set([f.candidate.key])), changed);
  assert.equal(writingContractIssue('intro', changed, contract), 'MEMORY_LITERAL_CHANGED');
});
test('legacy single-call correction is bounded and never returns an unresolved numeric observation', async () => {
  const f = fixture(), article = (text: string) => ({ title: f.outline.title, intro: [f.paragraph(text)], sections: [{ title: 'Seção sintética', paragraphs: [f.ordinary] }] });
  let calls = 0;
  const result = await writeCompleteArticle(f.outline, f.variables, { sections: [{}] }, async (_key, _schema, variables) => {
    calls++;
    if (calls === 1) return article(datum.replace('cerca de ', ''));
    assert.equal(JSON.parse(variables.sizing).revisionFeedback.violation, 'MEMORY_LITERAL_CHANGED');
    return article(datum);
  }, f.memory);
  assert.equal(calls, 2); assert.equal((result as ReturnType<typeof article>).intro[0].text, datum);
  calls = 0;
  await assert.rejects(writeCompleteArticle(f.outline, f.variables, { sections: [{}] }, async () => { calls++; return article(datum.replace('2025', '2026')); }, f.memory), /MEMORY_LITERAL_CHANGED/);
  assert.equal(calls, 2);
});
test('legacy sequential correction preserves context and refuses unresolved memory after two revisions', async () => {
  const f = fixture(); let calls = 0;
  const run = (fix: boolean) => writeSequentialArticle(f.outline, f.variables, { sections: [{}] }, async key => {
    if (key === 'section') return { title: 'Seção sintética', paragraphs: [f.ordinary] };
    calls++; return { paragraphs: [f.paragraph(fix && calls > 1 ? datum : '“' + datum + '”')] };
  }, f.evidence, undefined, undefined, [], undefined, f.memory);
  const result = await run(true); assert.equal(result.intro[0].text, datum); assert.equal(calls, 2);
  calls = 0; await assert.rejects(run(false), /MEMORY_LITERAL_CHANGED/); assert.equal(calls, 3);
});
test('legacy budget recovery cannot trim the qualifiers from an atomic bank paragraph', async () => {
  const f = fixture(); let calls = 0;
  await assert.rejects(writeSequentialArticle(f.outline, f.variables, { introChars: 35, sections: [{ budgetChars: 150 }] }, async key => {
    if (key === 'section') return { title: 'Seção sintética', paragraphs: [f.ordinary] };
    calls++; return { paragraphs: [f.paragraph(datum)] };
  }, f.evidence, undefined, undefined, [], undefined, f.memory), /ARTICLE_PART_SIZE_EXCEEDED/);
  assert.equal(calls, 3);
});
test('legacy provider stages never cache invalid memory and proof changes invalidate valid checkpoints', async () => {
  const f = fixture(), directory = await mkdtemp(join(tmpdir(), 'reporter-memory-legacy-'));
  const previousFetch = globalThis.fetch, previousKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'synthetic-test-key'; let calls = 0, valid = false;
  globalThis.fetch = async () => { calls++; return Response.json({ choices: [{ finish_reason: 'stop', message: {
    content: JSON.stringify({ paragraphs: [f.paragraph(valid ? datum : datum.replace('cerca de ', ''))] }) } }] }); };
  const traces: { hash: string; cached?: boolean }[] = [];
  const input = { pipeline: pipelineRevision(defaultPipelineDefinition('openai/gpt-oss-120b')), key: 'intro' as const, variables: f.variables,
    schema: PIPELINE_SCHEMAS.intro, directory, signal: new AbortController().signal, deferWritingRevision: true,
    writingContract: { evidence: f.evidence, memory: f.memory }, trace: async (call: { hash: string; cached?: boolean }) => { traces.push(call); } };
  try {
    const invalid = await executePipelineStep(input); assert.equal(invalid.needsRevision, true);
    assert.equal(await cacheRead(directory, 'pipeline-' + traces.at(-1)!.hash), null);
    await executePipelineStep(input); assert.equal(calls, 2);
    valid = true; await executePipelineStep(input); assert.equal(calls, 3);
    await executePipelineStep(input); assert.equal(calls, 3);
    assert.equal(traces.at(-1)!.cached, true);
    f.source.memory![0].items[0].selected.decisionId = 'synthetic-new-decision';
    f.candidate.memory!.selected.decisionId = 'synthetic-new-decision';
    input.variables.source = writingSource('Context', f.candidates, new Set([f.candidate.key]), new Map());
    await executePipelineStep(input); assert.equal(calls, 4); assert.equal(traces.at(-1)!.cached, false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = previousKey;
    await rm(directory, { recursive: true, force: true });
  }
});
