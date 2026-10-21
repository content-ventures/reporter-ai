import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createEditorialEngine, emptyEditorialCheckpoint, editorialCandidates, validateEditorialOutline } from '../src/runtime/editorial-engine.ts';
import { planEditorialOutline as plan } from '../src/server/editorial-outline.ts';
import { editorialResponseValid, outlineResponseSchema, withoutOpeningRepeats } from '../src/server/editorial-validation.ts';
import { executePipelineStep } from '../src/server/pipeline-runner.ts';
import { cacheRead } from '../src/server/storage.ts';
import { articlePreview } from '../src/server/article-preview.ts';
import { validPipelineOutput } from '../src/server/pipeline-output.ts';
import { defaultPipelineDefinition, pipelineRevision } from '../src/domain/pipeline.ts';
import type { PipelineCall, PipelineVariables } from '../src/domain/pipeline.ts';

const variables: PipelineVariables = { source: '', brief: '{}', sizing: '{}', outline: '', section: '', history: '', futureSections: '', layouts: '', approvedArticle: '', event: '', people: '' };

function planEditorialOutline(record: Parameters<typeof validateEditorialOutline>[0], variables: PipelineVariables, curateQuotes: boolean, call: Parameters<typeof plan>[0]['call']) {
  return plan({ sections: record.production.brief.sections, candidates: editorialCandidates(record), variables, curateQuotes, call,
    normalize: outline => {
      const valid = validateEditorialOutline(record, outline);
      assert.ok(valid.ok);
      return { title: valid.value.title, intro: { quotes: valid.value.intro }, sections: valid.value.sections };
    } });
}

const MATERIAL = 'Fonte sintética para teste. A cooperativa organiza os pedidos. A equipe verifica o pescado. O laboratório mantém os registros. O varejo recebe os lotes.';

async function fixture(text = MATERIAL) {
  let sequence = 0;
  const engine = createEditorialEngine(emptyEditorialCheckpoint(), { next: prefix => prefix + '-' + ++sequence });
  const created = await engine.commands.createFromSource({ title: 'Planejamento sintético',
    material: { text, origin: 'podcast', authorized: true },
    brief: { size: 'standard', sections: 2 }, plan: ['article'] });
  assert.ok(created.ok);
  const record = engine.records.record(created.value.productionId)!;
  const ids = editorialCandidates(record).map(candidate => candidate.key);
  assert.ok(ids.length >= 3);
  const proposal = { title: '  Artigo sintético  ', introIds: [ids[0]], sections: [
    { title: 'Pedidos', evidenceIds: [ids[1]] }, { title: 'Registros', evidenceIds: [ids[2]] },
  ] };
  return { engine, record, ids, proposal };
}

test('automatic planning follows the pauta and gives the live preview stable blocks before writing', async () => {
  const f = await fixture(), calls: string[] = [];
  try {
    const outline = await planEditorialOutline(f.record, variables, true, async (key, _schema, input) => {
      calls.push(key);
      if (key === 'outline') return f.proposal;
      assert.equal(JSON.parse(input.outline).sections.length, 2);
      return { introIds: [], sectionIds: [[f.ids[1]], [f.ids[2]]] };
    });
    assert.deepEqual(calls, ['outline', 'quotes']);
    assert.equal(outline.title, 'Artigo sintético');
    assert.equal(outline.intro?.quotes.length, 0);
    assert.ok(outline.sections.every(section => section.blockId && section.quotes.length === 1));
    const again = await planEditorialOutline(f.record, variables, true, async key => key === 'outline' ? f.proposal : { introIds: [], sectionIds: [[f.ids[1]], [f.ids[2]]] });
    assert.deepEqual(again, outline, 'retrying cached planning keeps the same preview block IDs');
    const stages = new Map([['section-0', JSON.stringify({ title: 'Pedidos', paragraphs: [{ text: 'Primeiro trecho em tempo real.', evidenceIds: [f.ids[1]] }] })]]);
    const preview = articlePreview('run-test', outline, true, stages);
    assert.equal(preview.blocks[0].id, articlePreview('run-test', again, true, stages).blocks[0].id);
    assert.equal(preview.blocks[1].type, 'paragraph');
  } finally { f.engine.store.dispose(); }
});

test('automatic planning rejects invented, repeated and incomplete evidence before writing', async () => {
  const f = await fixture();
  try {
    for (const proposal of [
      { ...f.proposal, introIds: ['invented'] },
      { ...f.proposal, introIds: [f.ids[1]] },
      { ...f.proposal, sections: f.proposal.sections.slice(0, 1) },
    ]) await assert.rejects(planEditorialOutline(f.record, variables, false, async () => proposal), /INVALID_OUTLINE/);
    for (const selection of [
      { introIds: [], sectionIds: [[f.ids[1]]] },
      { introIds: [], sectionIds: [[f.ids[1]], ['invented']] },
      { introIds: [f.ids[1]], sectionIds: [[f.ids[1]], [f.ids[2]]] },
    ]) await assert.rejects(planEditorialOutline(f.record, variables, true, async key => key === 'outline' ? f.proposal : selection), /INVALID_QUOTE_SELECTION/);
    let calls = 0;
    await planEditorialOutline(f.record, variables, false, async key => { assert.equal(key, 'outline'); calls++; return f.proposal; });
    assert.equal(calls, 1, 'curation remains optional in the configured pipeline');
  } finally { f.engine.store.dispose(); }
});

test('automatic planning accepts four opening passages, not five', async () => {
  const f = await fixture(`${MATERIAL} O porto embarca as caixas. A fábrica congela o filé. O mercado compra a tilápia.`);
  try {
    assert.ok(f.ids.length >= 7);
    const sectionIds = [[f.ids[5]], [f.ids[6]]];
    const proposal = (introIds: string[]) => ({ ...f.proposal, introIds,
      sections: f.proposal.sections.map((section, index) => ({ ...section, evidenceIds: sectionIds[index] })) });
    const four = await planEditorialOutline(f.record, variables, false, async () => proposal(f.ids.slice(0, 4)));
    assert.equal(four.intro?.quotes.length, 4);
    await assert.rejects(planEditorialOutline(f.record, variables, false, async () => proposal(f.ids.slice(0, 5))), { name: 'ZodError' });
    const curated = await planEditorialOutline(f.record, variables, true, async key => key === 'outline' ? f.proposal : { introIds: f.ids.slice(0, 4), sectionIds });
    assert.equal(curated.intro?.quotes.length, 4);
    await assert.rejects(planEditorialOutline(f.record, variables, true, async key => key === 'outline' ? f.proposal : { introIds: f.ids.slice(0, 5), sectionIds }), { name: 'ZodError' });
    assert.equal(validPipelineOutput('quotes', { introIds: f.ids.slice(0, 4), sectionIds }), true);
    assert.equal(validPipelineOutput('quotes', { introIds: f.ids.slice(0, 5), sectionIds }), false);
    assert.equal(validPipelineOutput('outline', proposal(f.ids.slice(0, 4))), true);
    assert.equal(validPipelineOutput('outline', proposal(f.ids.slice(0, 5))), false);
  } finally { f.engine.store.dispose(); }
});

const KNOWN = new Set(['0', '1', '2', '3', '4', '5']);
const OVERLAP = { title: 'Título da notícia', introIds: ['0', '1'], sections: [
  { title: 'Primeira seção', evidenceIds: ['1', '2'] }, { title: 'Segunda seção', evidenceIds: ['3', '0', '4'] },
] };

test('a section drops the ids the opening already uses, never down to an empty section', () => {
  assert.equal(editorialResponseValid('outline', OVERLAP, KNOWN, 2), false);
  const outline = withoutOpeningRepeats('outline', OVERLAP);
  assert.deepEqual(outline, { title: 'Título da notícia', introIds: ['0', '1'], sections: [
    { title: 'Primeira seção', evidenceIds: ['2'] }, { title: 'Segunda seção', evidenceIds: ['3', '4'] },
  ] });
  assert.equal(editorialResponseValid('outline', outline, KNOWN, 2), true);
  assert.deepEqual(OVERLAP.sections[0].evidenceIds, ['1', '2'], 'the answer received is never changed in place');
  const selection = withoutOpeningRepeats('quotes', { introIds: ['0'], sectionIds: [['0', '2'], ['3']] });
  assert.deepEqual(selection, { introIds: ['0'], sectionIds: [['2'], ['3']] });
  assert.equal(editorialResponseValid('quotes', selection, KNOWN, 2), true);
  // A section made only of opening ids stays as it came, so validation still rejects it.
  const emptied = { ...OVERLAP, sections: [{ title: 'Primeira seção', evidenceIds: ['1'] }, { title: 'Segunda seção', evidenceIds: ['3'] }] };
  assert.equal(withoutOpeningRepeats('outline', emptied), emptied);
  assert.equal(editorialResponseValid('outline', emptied, KNOWN, 2), false);
  const emptiedSelection = { introIds: ['0'], sectionIds: [['0'], ['3']] };
  assert.equal(withoutOpeningRepeats('quotes', emptiedSelection), emptiedSelection);
  assert.equal(editorialResponseValid('quotes', emptiedSelection, KNOWN, 2), false);
});

test('a repeat inside a part or between sections is still rejected', () => {
  for (const value of [
    { ...OVERLAP, introIds: ['0', '0'], sections: [{ title: 'A', evidenceIds: ['2'] }, { title: 'B', evidenceIds: ['3'] }] },
    { ...OVERLAP, sections: [{ title: 'A', evidenceIds: ['2', '2'] }, { title: 'B', evidenceIds: ['3'] }] },
    { ...OVERLAP, sections: [{ title: 'A', evidenceIds: ['1', '2', '2'] }, { title: 'B', evidenceIds: ['3'] }] },
    { ...OVERLAP, sections: [{ title: 'A', evidenceIds: ['2', '1'] }, { title: 'B', evidenceIds: ['2'] }] },
  ]) assert.equal(editorialResponseValid('outline', withoutOpeningRepeats('outline', value), KNOWN, 2), false, JSON.stringify(value));
  for (const value of [
    { introIds: ['0'], sectionIds: [['2', '2'], ['3']] },
    { introIds: ['0'], sectionIds: [['0', '2'], ['2']] },
  ]) assert.equal(editorialResponseValid('quotes', withoutOpeningRepeats('quotes', value), KNOWN, 2), false, JSON.stringify(value));
  // Only the outline and the curation are planned with an opening.
  for (const key of ['intro', 'section', 'article', 'facts'] as const) assert.equal(withoutOpeningRepeats(key, OVERLAP), OVERLAP);
  for (const value of [null, 'texto', { introIds: [], sections: OVERLAP.sections }, { introIds: ['0'] }]) assert.equal(withoutOpeningRepeats('outline', value), value);
});

test('a valid plan comes back exactly as the provider wrote it', () => {
  // As v0.17.0 accepted it: up to four opening ids, none of them in a section.
  const outline = { title: 'Ateliê Sul amplia exportação para o Chile', introIds: ['0', '45', '173'], sections: [
    { title: 'Mercado externo', evidenceIds: ['46', '47'] }, { title: 'Inteligência artificial', evidenceIds: ['120'] }, { title: 'Escola de ofício', evidenceIds: ['231', '233'] },
  ] };
  const text = JSON.stringify(outline);
  assert.equal(withoutOpeningRepeats('outline', outline), outline);
  assert.equal(JSON.stringify(withoutOpeningRepeats('outline', JSON.parse(text))), text);
  const selection = { introIds: ['0', '45'], sectionIds: [['46'], ['120', '121'], ['231']] };
  assert.equal(withoutOpeningRepeats('quotes', selection), selection);
});

test('the provider step validates, caches and hands planning the plan without the opening ids in a section', async () => {
  const f = await fixture(`${MATERIAL} O porto embarca as caixas. A fábrica congela o filé. O mercado compra a tilápia.`);
  const directory = await mkdtemp(join(tmpdir(), 'reporter-opening-ids-'));
  const environment = { local: process.env.REPORTER_LOCAL_MODE, key: process.env.GROQ_API_KEY }, original = globalThis.fetch;
  process.env.REPORTER_LOCAL_MODE = 'true';
  process.env.GROQ_API_KEY = 'test-placeholder-not-a-real-key';
  const answers: unknown[] = [];
  globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answers.shift()) } }] });
  const known = new Set(f.ids), traces: PipelineCall[] = [], sent: string[] = [];
  const step = (key: 'outline' | 'quotes', schema: object, values: PipelineVariables) => executePipelineStep({ pipeline: pipelineRevision(defaultPipelineDefinition()), key, variables: values,
    schema, directory, signal: new AbortController().signal, trace: async (call: PipelineCall) => { traces.push(call); },
    validateOutput: value => editorialResponseValid(key, value, known, 2) });
  try {
    const { ids } = f;
    answers.push({ title: 'Artigo sintético', introIds: [ids[0], ids[1]], sections: [{ title: 'Pedidos', evidenceIds: [ids[1], ids[2]] }, { title: 'Registros', evidenceIds: [ids[3]] }] },
      { introIds: [ids[0], ids[1]], sectionIds: [[ids[0], ids[2]], [ids[3], ids[4]]] });
    const outline = await planEditorialOutline(f.record, variables, true, async (key, schema, values) => {
      if (key === 'quotes') sent.push(values.outline);
      return (await step(key, schema, values)).value;
    });
    // Curation reads, the cache keeps and Estrutura shows the plan without the repeat.
    assert.deepEqual(JSON.parse(sent[0]).sections.map((section: { evidenceIds: string[] }) => section.evidenceIds), [[ids[2]], [ids[3]]]);
    const saved = await Promise.all(traces.filter(call => call.status === 'completed').map(call => cacheRead<{ value: unknown }>(directory, 'pipeline-' + call.hash)));
    assert.deepEqual(saved.map(entry => entry?.value), [
      { title: 'Artigo sintético', introIds: [ids[0], ids[1]], sections: [{ title: 'Pedidos', evidenceIds: [ids[2]] }, { title: 'Registros', evidenceIds: [ids[3]] }] },
      { introIds: [ids[0], ids[1]], sectionIds: [[ids[2]], [ids[3], ids[4]]] },
    ]);
    const byKey = new Map(editorialCandidates(f.record).map(candidate => [candidate.key, candidate.ref]));
    assert.deepEqual(outline.intro?.quotes, [byKey.get(ids[0]), byKey.get(ids[1])]);
    assert.deepEqual(outline.sections.map(section => section.quotes), [[byKey.get(ids[2])], [byKey.get(ids[3]), byKey.get(ids[4])]]);
    // A section made only of the opening's ids still fails before the cache.
    answers.push({ title: 'Outro artigo', introIds: [ids[0]], sections: [{ title: 'Pedidos', evidenceIds: [ids[0]] }, { title: 'Registros', evidenceIds: [ids[3]] }] });
    await assert.rejects(step('outline', outlineResponseSchema(2, f.ids), { ...variables, brief: 'Outra pauta' }), /INVALID_PROVIDER_OUTPUT/);
    assert.equal(await cacheRead(directory, 'pipeline-' + traces.at(-1)!.hash), null);
  } finally {
    globalThis.fetch = original;
    for (const [name, value] of [['REPORTER_LOCAL_MODE', environment.local], ['GROQ_API_KEY', environment.key]] as const)
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    await rm(directory, { recursive: true, force: true });
    f.engine.store.dispose();
  }
});
