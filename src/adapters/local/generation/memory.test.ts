import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blockText, paragraphBlock, type ArticleBody } from '../../../domain/article.ts';
import { memoryArticleContentIssues } from '../../../domain/editorial-memory-article.ts';
import { validateMemoryArticle } from '../../../domain/editorial-memory-guard.ts';
import { createTranscriptSource, type Source } from '../../../domain/source.ts';
import { parseTranscript } from '../../../domain/text/transcript-parse.ts';
import { memoryWritingFixture } from '../../../domain/testing/editorial-memory.ts';
import { baseRecord, createKit } from '../../../domain/testing/scenario.ts';
import { editorialCandidates } from '../../../runtime/editorial-engine.ts';
import { extractivePlan, extractivePlanFromOutline, materialMeta, planBlocks, type DraftPlan } from './draft-plan.ts';
import { createVoices, headlineLine } from './editorial.ts';
import { lineRef, lineSentences, materialLineKey, pickKeyQuotes, readMaterial } from './material.ts';
import { normalizeOutline } from './outline.ts';
import { createRng } from './random.ts';
import { planAsk, planExpand, planToList, validateMemoryAssistPlan } from './assist-plan.ts';
import { applySuggestion } from '../../../domain/suggestion.ts';
import { segmentRef } from '../../../domain/refs.ts';
import { createLocalGenerationService } from './local-generation.ts';

let n = 0;
const ctx = { now: '2026-10-28T20:00:00Z', actorId: 'actor', newId: (prefix: string) => `${prefix}-${++n}` };
const workspace = 'workspace';
const bank = (kind: 'citation' | 'statistic', text: string) => memoryWritingFixture(kind, text, ctx, workspace);
function input(sources: Source[]) {
  return { sources, brief: { sections: 3, size: 'standard' as const, revision: 1 }, fallbackTitle: 'Pauta sintética',
    newId: ctx.newId, rng: createRng('bank-reader'), images: false as const };
}
function body(plan: DraftPlan): ArticleBody { return { type: 'article', title: plan.title, blocks: planBlocks(plan) }; }

test('local and legacy readers include only selected literal bank records and their immutable kinds', () => {
  const stat = bank('statistic', 'Foram atendidas cerca de 240 pessoas em 2025. A observação inclui apenas o projeto piloto.'),
    quote = bank('citation', 'Como podemos  ouvir\n todas as pessoas neste exemplo sintético?');
  const sources = [stat.source, quote.source], material = readMaterial(sources);
  assert.equal(material.lines.length, 2); assert.deepEqual(material.lines.map(line => line.question), [false, false]);
  assert.equal(material.lines[0].speaker, undefined);
  assert.equal(material.lines[0].sentences.length, 1, 'a qualifier in another sentence stays with the datum');
  const candidates = editorialCandidates({ ...baseRecord(createKit()), sources });
  assert.deepEqual(candidates.map(candidate => candidate.memory?.kind), ['statistic', 'citation']);
  assert.ok(!JSON.stringify(candidates).includes('PRIVATE'));
  assert.deepEqual(candidates[0].memory?.selected, stat.source.memory![0].items[0].selected);
});
test('short bank statistics are paragraphs with full context, without quoted headlines or fabricated padding', () => {
  const text = 'Cerca de 240 pessoas em 2025.', { source, item } = bank('statistic', text);
  const material = readMaterial([source]);
  assert.deepEqual(pickKeyQuotes(material, 3, createRng('x')), []);
  assert.equal(headlineLine(material, new Set(), createVoices(material, undefined)), undefined);
  const plan = extractivePlan(input([source])); assert.ok(plan.ok);
  assert.equal(materialMeta(plan.value), '1 dado');
  const article = body(plan.value), paragraphs = article.blocks.filter(block => block.type === 'paragraph');
  assert.equal(article.title, 'Pauta sintética'); assert.equal(paragraphs.length, 1); assert.equal(blockText(paragraphs[0]), text);
  assert.ok(!article.blocks.some(block => block.type === 'quote'));
  assert.equal(validateMemoryArticle(article, [source], [item]).ok, true);
});
test('long multi-sentence observations remain atomic even below a section word budget', () => {
  const text = 'Foram atendidas cerca de 240 pessoas em 2025. ' + 'Apenas os participantes do projeto piloto foram incluídos nesta observação sintética, '.repeat(5) + 'sem extrapolação.';
  const { source, item } = bank('statistic', text), plan = extractivePlan(input([source])); assert.ok(plan.ok);
  assert.ok(body(plan.value).blocks.some(block => blockText(block) === text));
  assert.equal(validateMemoryArticle(body(plan.value), [source], [item]).ok, true);
});
test('bank citations keep exact whitespace and punctuation through extractive reported speech', () => {
  const text = 'Queremos  ouvir\n todas as pessoas neste exemplo sintético.', { source, item } = bank('citation', text);
  const plan = extractivePlan(input([source])); assert.ok(plan.ok);
  const article = body(plan.value); assert.ok(article.blocks.some(block => blockText(block).includes(text)));
  assert.equal(validateMemoryArticle(article, [source], [item]).ok, true);
});
test('collections with repeated segment ids retain distinct outline ownership and draft references', () => {
  const a = bank('statistic', 'Cerca de 240 pessoas em 2025.'), b = bank('statistic', 'Cerca de 240 pessoas em 2025 no Sul.');
  const sources = [a.source, b.source], material = readMaterial(sources), refs = material.lines.map(line => lineRef(line));
  assert.equal(material.lines[0].segmentId, material.lines[1].segmentId);
  assert.notEqual(materialLineKey(material.lines[0]), materialLineKey(material.lines[1]));
  const outline = normalizeOutline({ title: 'Pauta sintética', sections: refs.map((ref, i) => ({ title: `Observação ${i + 1}`, quotes: [ref] })) },
    { size: 'standard', material, defaultTitle: () => 'Pauta sintética' }); assert.ok(outline.ok);
  const plan = extractivePlanFromOutline(input(sources), outline.value); assert.ok(plan.ok);
  assert.deepEqual(plan.value.sections.map(section => section.blocks[0].sourceRefs![0].sourceId), sources.map(source => source.id));
  assert.equal(validateMemoryArticle(body(plan.value), sources, [a.item, b.item]).ok, true);
});
test('an explicit outline introduction never renders a statistic as speech', () => {
  const a = bank('statistic', 'Cerca de 240 pessoas em 2025.'), b = bank('statistic', 'Cerca de 240 pessoas em 2025 no Sul.'), sources = [a.source, b.source];
  const [lead, section] = readMaterial(sources).lines.map(line => lineRef(line));
  const plan = extractivePlanFromOutline(input(sources), { title: 'Pauta sintética', intro: [lead],
    sections: [{ blockId: 'section', title: 'Observação sintética', quotes: [section] }] }); assert.ok(plan.ok);
  assert.equal(plan.value.intro[0].type, 'paragraph'); assert.equal(blockText(plan.value.intro[0]), a.item.view.evidence.anchor.excerpt);
  assert.deepEqual(memoryArticleContentIssues(body(plan.value), sources), []);
});
test('bank data never supplies a fabricated portrait or image authorization', () => {
  const { source, item } = bank('statistic', 'Foram atendidas cerca de 240 pessoas em 2025 nas lojas de museu em Lisboa.');
  const plan = extractivePlan({ ...input([source]), images: undefined }); assert.ok(plan.ok);
  assert.ok(!body(plan.value).blocks.some(block => block.type === 'figure'));
  assert.equal(plan.value.coverSlot, undefined);
  assert.equal(validateMemoryArticle(body(plan.value), [source], [item]).ok, true);
});
test('malformed or unauthorized collections refuse generation instead of silently omitting evidence', () => {
  const { source } = bank('statistic', 'Cerca de 240 pessoas em 2025.');
  for (const mutate of [(copy: Source) => { copy.memory![0].items = []; }, (copy: Source) => { copy.versions[0].content.segments[0].text += ' changed'; },
    (copy: Source) => { copy.rights.authorized = false; }]) {
    const copy = structuredClone(source); mutate(copy);
    const plan = extractivePlan(input([copy])); assert.ok(!plan.ok); assert.equal(plan.refusal.code, 'memory_not_ready');
  }
});
test('ordinary interviews keep sentence spans and research never becomes bank original evidence', () => {
  const ordinary = createTranscriptSource({ workspaceId: workspace, title: 'Interview', origin: 'interview',
    parsed: parseTranscript('Pessoa: Primeira frase deste teste sintético. Outra frase do mesmo falante.'), authorized: true }, ctx);
  const { source } = bank('statistic', 'Cerca de 240 pessoas em 2025.');
  const material = readMaterial([ordinary, { ...source, research: { provider: 'tavily', runId: 'test', query: 'synthetic', retrievedAt: ctx.now, publishedOn: null } }]);
  assert.equal(material.lines.length, 1); assert.equal(lineSentences(material.lines[0]).length, 2);
});
test('the local assistant answers bank questions with complete data and literal citations', () => {
  const stat = bank('statistic', 'Foram atendidas cerca de 240 pessoas em 2025. Apenas participantes do piloto foram incluídos.'),
    quote = bank('citation', 'Queremos  ouvir\n todas as pessoas neste exemplo sintético.');
  const context = { sources: [stat.source, quote.source], newId: ctx.newId }, empty: ArticleBody = { type: 'article', title: '', blocks: [] };
  const plan = planAsk(empty, 'Quais pessoas participaram?', undefined, context); assert.ok(plan.ok);
  const checked = validateMemoryAssistPlan(empty, plan.value, context); assert.ok(checked.ok);
  assert.ok(checked.value.reply.some(block => blockText(block) === stat.item.view.evidence.anchor.excerpt));
  assert.ok(checked.value.reply.some(block => blockText(block).includes(quote.item.view.evidence.anchor.excerpt)));
  assert.ok(checked.value.reply.every(block => !blockText(block).includes('memory-person-')));
});
test('local list conversion keeps a multi-sentence statistic as one complete item', () => {
  const text = 'Foram atendidas cerca de 240 pessoas em 2025. Apenas participantes do piloto foram incluídos.', { source, item } = bank('statistic', text);
  const ref = lineRef(readMaterial([source]).lines[0]);
  const article: ArticleBody = { type: 'article', title: '', blocks: [paragraphBlock('p', 'Introdução editorial. ' + text + ' Encerramento editorial.', { sourceRefs: [ref] })] };
  const context = { sources: [source], newId: ctx.newId };
  const plan = planToList(article, [{ blockId: 'p', from: 0, to: blockText(article.blocks[0]).length }], context); assert.ok(plan.ok);
  const checked = validateMemoryAssistPlan(article, plan.value, context); assert.ok(checked.ok);
  const suggestion = checked.value.suggestions[0], applied = applySuggestion(article, { ...suggestion, state: 'ready', anchorText: [blockText(article.blocks[0])] }); assert.ok(applied.ok);
  const list = applied.value.blocks[0]; assert.equal(list.type, 'list'); assert.ok(list.items.some(item => item.map(inline => inline.text).join('') === text));
  assert.equal(validateMemoryArticle(applied.value, [source], [item]).ok, true);
});
test('local expansion restores the entire selected observation without exposing unselected original text', () => {
  const text = 'Foram atendidas cerca de 240 pessoas em 2025. Apenas participantes do piloto foram incluídos.', { source, item } = bank('statistic', text);
  const partial = text.slice(0, text.indexOf('.') + 1), line = readMaterial([source]).lines[0];
  const ref = segmentRef(source.id, line.sourceVersion, line.segmentId, { from: 0, to: partial.length });
  const article: ArticleBody = { type: 'article', title: '', blocks: [paragraphBlock('p', partial, { sourceRefs: [ref] })] }, context = { sources: [source], newId: ctx.newId };
  const plan = planExpand(article, [{ blockId: 'p', from: 0, to: partial.length }], context); assert.ok(plan.ok);
  const checked = validateMemoryAssistPlan(article, plan.value, context); assert.ok(checked.ok);
  const applied = applySuggestion(article, { ...checked.value.suggestions[0], state: 'ready', anchorText: [partial] }); assert.ok(applied.ok);
  assert.equal(blockText(applied.value.blocks[0]), text); assert.equal(validateMemoryArticle(applied.value, [source], [item]).ok, true);
  assert.equal(JSON.stringify(checked).includes('PRIVATE'), false);
});
test('the public local generation service refuses a shortening that removes numeric context', async () => {
  const text = 'Foram atendidas cerca de 240 pessoas em 2025. Apenas participantes do piloto foram incluídos nesta observação sintética.', { source } = bank('statistic', text);
  const ref = lineRef(readMaterial([source]).lines[0]), record = { ...baseRecord(createKit()), sources: [source] };
  const article: ArticleBody = { type: 'article', title: '', blocks: [paragraphBlock('p', text, { sourceRefs: [ref] })] };
  record.pieces[0].draft.body = article;
  const service = createLocalGenerationService({ getRecord: () => record, actorId: () => 'actor',
    clock: { now: () => ctx.now }, ids: { next: ctx.newId }, sleep: async () => undefined });
  const started = await service.start('article.shorten', { productionId: record.production.id, pieceId: record.pieces[0].id,
    body: article, baseRevision: 0, target: [{ blockId: 'p', from: 0, to: text.length }] });
  assert.ok(!started.ok); assert.equal(started.refusal.code, 'no_change'); assert.match(started.refusal.message, /contexto/);
  assert.equal(service.snapshots().length, 0); assert.equal(blockText(article.blocks[0]), text);
});
