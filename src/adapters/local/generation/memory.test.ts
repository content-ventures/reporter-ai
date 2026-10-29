import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blockText, type ArticleBody } from '../../../domain/article.ts';
import { memoryArticleContentIssues } from '../../../domain/editorial-memory-article.ts';
import { validateMemoryArticle } from '../../../domain/editorial-memory-guard.ts';
import { createMemoryMaterial, memoryBlocks } from '../../../domain/editorial-memory-import.ts';
import { materializeMemoryCandidates, type MemoryCandidate } from '../../../domain/editorial-memory-extraction.ts';
import { prepareMemoryWriting, type MemoryWritingItem } from '../../../domain/editorial-memory-writing.ts';
import { initialMemoryPolicy, memoryEligibility, memoryEvidenceRef, reviewMemoryEvidence, type MemorySelection } from '../../../domain/editorial-memory.ts';
import { createTranscriptSource, type Source } from '../../../domain/source.ts';
import { parseTranscript } from '../../../domain/text/transcript-parse.ts';
import { baseRecord, createKit } from '../../../domain/testing/scenario.ts';
import { editorialCandidates } from '../../../runtime/editorial-engine.ts';
import { extractivePlan, extractivePlanFromOutline, materialMeta, planBlocks, type DraftPlan } from './draft-plan.ts';
import { createVoices, headlineLine } from './editorial.ts';
import { lineRef, lineSentences, materialLineKey, pickKeyQuotes, readMaterial } from './material.ts';
import { normalizeOutline } from './outline.ts';
import { createRng } from './random.ts';

let n = 0;
const ctx = { now: '2026-10-28T20:00:00Z', actorId: 'actor', newId: (prefix: string) => `${prefix}-${++n}` };
const workspace = 'workspace', policy = initialMemoryPolicy(workspace);
function bank(kind: 'citation' | 'statistic', text: string) {
  const original = 'PRIVATE HEADER. ' + text + ' PRIVATE FOOTER.';
  const { material, source } = createMemoryMaterial({ title: kind, kind: 'report', text: original, authorized: true,
    primaryOrigin: kind, originalFileId: null, metadata: { publishedOn: null, recordedOn: null, institution: null,
      company: null, event: null, edition: null, topics: [], originalUrl: null } }, workspace, ctx);
  const common = { excerpt: text, from: original.indexOf(text) };
  const candidate: MemoryCandidate = kind === 'citation' ? { ...common, kind, kinds: ['opinion'] } : { ...common, kind, kinds: ['declared'],
    indicator: 'Pessoas', raw: '240', unit: 'pessoas', period: '2025', geography: null, population: null, qualifier: text.includes('cerca de') ? 'cerca de' : 'Cerca de', issuingInstitution: null };
  const evidence = materializeMemoryCandidates([candidate], memoryBlocks(material, 'job', original)[0], material, { from: 0, text: original }, ctx)[0];
  if (evidence.kind === 'citation') { evidence.personId = 'author'; evidence.authorConfirmed = true; }
  const decision = reviewMemoryEvidence({ evidence: memoryEvidenceRef(evidence), check: null, policyRevision: 1,
    previousSequence: 0, action: 'accept', reason: 'Synthetic technical review', supports: [] }, evidence, source, policy, null, null,
    { personId: 'actor', workspaceId: workspace, roles: ['editor'] }, ctx);
  assert.ok(decision.ok);
  const item: MemoryWritingItem = { policy, ...(kind === 'citation' ? { author: { id: 'author', name: 'Pessoa Fictícia', title: 'Porta-voz', organization: 'Organização sintética' } } : {}),
    view: { evidence, material: { id: material.id, title: material.title, kind: material.kind, primaryOrigin: material.primaryOrigin },
      check: null, decision: decision.value, eligibility: memoryEligibility(evidence, source, policy, null, decision.value),
      relevance: null, uses: { selected: 0, inserted: 0, approved: 0, published: 0 } } };
  const selection: MemorySelection = { id: ctx.newId('selection'), workspaceId: workspace, revision: 1, productionId: null,
    items: [{ evidence: memoryEvidenceRef(evidence), check: null, decisionId: decision.value.id, policyRevision: 1 }],
    createdBy: 'actor', updatedBy: 'actor', createdAt: ctx.now, updatedAt: ctx.now };
  const prepared = prepareMemoryWriting(selection, [item], 'Pauta sintética', ctx); assert.ok(prepared.ok);
  return { source: prepared.value.source as Source, item };
}
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
