import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEditorialEngine, emptyEditorialCheckpoint, editorialCandidates, validateEditorialOutline } from '../src/runtime/editorial-engine.ts';
import { planEditorialOutline as plan } from '../src/server/editorial-outline.ts';
import { articlePreview } from '../src/server/article-preview.ts';
import type { PipelineVariables } from '../src/domain/pipeline.ts';

const variables: PipelineVariables = { source: '', brief: '{}', sizing: '{}', outline: '', section: '', history: '', futureSections: '', layouts: '', approvedArticle: '' };

function planEditorialOutline(record: Parameters<typeof validateEditorialOutline>[0], variables: PipelineVariables, curateQuotes: boolean, call: Parameters<typeof plan>[0]['call']) {
  return plan({ sections: record.production.brief.sections, candidates: editorialCandidates(record), variables, curateQuotes, call,
    normalize: outline => {
      const valid = validateEditorialOutline(record, outline);
      assert.ok(valid.ok);
      return { title: valid.value.title, intro: { quotes: valid.value.intro }, sections: valid.value.sections };
    } });
}

async function fixture() {
  let sequence = 0;
  const engine = createEditorialEngine(emptyEditorialCheckpoint(), { next: prefix => prefix + '-' + ++sequence });
  const created = await engine.commands.createFromSource({ title: 'Planejamento sintético',
    material: { text: 'Fonte sintética para teste. A cooperativa organiza os pedidos. A equipe verifica o pescado. O laboratório mantém os registros. O varejo recebe os lotes.', origin: 'podcast', authorized: true },
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
