import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ArticleBody, ParagraphBlock, QuoteBlock } from './article.ts';
import { articleHash, blockText } from './article.ts';
import { articleCitations } from './editorial-memory-legacy.ts';
import { prepareMemoryWriting, memoryWritingOccurrences, type MemoryWritingItem } from './editorial-memory-writing.ts';
import { createMemoryMaterial, memoryBlocks } from './editorial-memory-import.ts';
import { materializeMemoryCandidates, type MemoryCandidate } from './editorial-memory-extraction.ts';
import { initialMemoryPolicy, memoryEvidenceRef, memoryEligibility, reviewMemoryEvidence, type MemorySelection } from './editorial-memory.ts';

let n = 0;
const ctx = { now: '2026-10-28T20:00:00Z', actorId: 'actor', newId: (prefix: string) => `${prefix}-${++n}` };
const workspace = 'workspace', policy = initialMemoryPolicy(workspace);
function item(kind: 'citation' | 'statistic', text: string): MemoryWritingItem {
  const original = 'PRIVATE UNUSED ORIGINAL HEADER. ' + text + ' PRIVATE UNUSED ORIGINAL FOOTER.';
  const { material, source } = createMemoryMaterial({ title: kind, kind: 'report', text: original, authorized: true, primaryOrigin: kind, originalFileId: null,
    metadata: { publishedOn: null, recordedOn: null, institution: null, company: null, event: null, edition: null, topics: [], originalUrl: null } }, workspace, ctx);
  const common = { excerpt: text, from: original.indexOf(text) };
  const candidate: MemoryCandidate = kind === 'citation' ? { ...common, kind: 'citation', kinds: ['opinion'] } : { ...common, kind: 'statistic', kinds: ['declared'],
    indicator: 'Pessoas', raw: '240', unit: 'pessoas', period: '2025', geography: null, population: null, qualifier: 'cerca de', issuingInstitution: null };
  const evidence = materializeMemoryCandidates([candidate], memoryBlocks(material, 'job', original)[0], material, { from: 0, text: original }, ctx)[0];
  if (evidence.kind === 'citation') { evidence.personId = 'author'; evidence.authorConfirmed = true; }
  const reviewed = reviewMemoryEvidence({ evidence: memoryEvidenceRef(evidence), check: null, policyRevision: 1, previousSequence: 0, action: 'accept', reason: 'Synthetic technical review', supports: [] },
    evidence, source, policy, null, null, { personId: 'actor', workspaceId: workspace, roles: ['editor'] }, ctx);
  if (!reviewed.ok) throw new Error(reviewed.refusal.message);
  return { policy, ...(kind === 'citation' ? { author: { id: 'author', name: 'Pessoa fictícia', title: 'Porta-voz', organization: 'Organização sintética' } } : {}),
    view: { evidence, material: { id: material.id, title: material.title, kind: material.kind, primaryOrigin: material.primaryOrigin }, check: null, decision: reviewed.value,
      eligibility: memoryEligibility(evidence, source, policy, null, reviewed.value), relevance: null, uses: { selected: 0, inserted: 0, approved: 0, published: 0 } } };
}
const items = [item('statistic', 'Foram atendidas cerca de 240 pessoas em 2025.'), item('citation', 'Queremos ouvir todas as pessoas neste exemplo sintético.')];
const selection: MemorySelection = { id: 'selection', workspaceId: workspace, revision: 1, productionId: null,
  items: items.map(item => ({ evidence: memoryEvidenceRef(item.view.evidence), decisionId: item.view.decision!.id, check: null, policyRevision: 1 })),
  createdBy: 'actor', createdAt: ctx.now, updatedBy: 'actor', updatedAt: ctx.now };
function prepared() {
  const result = prepareMemoryWriting(selection, items, 'Artigo sintético', ctx);
  if (!result.ok) throw new Error(result.refusal.message); return result.value;
}
test('multi-material writing preserves order, original anchors, literal context and known authors without copying private originals', () => {
  const { source, body } = prepared();
  assert.deepEqual(body.blocks.map(block => block.type), ['paragraph', 'quote', 'paragraph']);
  assert.equal(blockText(body.blocks[0]), items[0].view.evidence.anchor.excerpt);
  assert.equal(blockText(body.blocks[1]), items[1].view.evidence.anchor.excerpt);
  assert.equal(blockText(body.blocks[2]), '— Pessoa fictícia, Porta-voz, Organização sintética');
  assert.equal(source.versions[0].content.segments.length, 2);
  assert.ok(source.versions[0].content.segments.every(segment => !segment.text.includes('PRIVATE UNUSED')));
  assert.deepEqual(source.memory[0].items.map(item => item.selected), selection.items);
  assert.deepEqual(source.memory[0].items.map(item => item.anchor), items.map(item => item.view.evidence.anchor));
  assert.ok(source.memory[0].items.every(item => item.anchor.source.sourceId !== source.id));
  assert.equal(source.createdBy, ctx.actorId); assert.equal(source.rights.authorizedBy, ctx.actorId);
  assert.equal(source.recordedOn, undefined); assert.equal(source.sourceUrl, undefined); assert.equal(source.transcriptId, undefined);
  const speaker = source.speakers[0]; assert.equal(speaker.personId, 'author');
  assert.equal(source.versions[0].content.segments[1].speaker, speaker.label);
  const occurrences = memoryWritingOccurrences(body, source); assert.equal(occurrences.length, 2);
  assert.deepEqual(occurrences.map(item => item.binding.selected.evidence), selection.items.map(item => item.evidence));
});
test('changed evidence, review, policy, source availability or author cannot produce a partial writing result', () => {
  const mutations: ((copy: MemoryWritingItem[]) => void)[] = [
    copy => { copy[1].view.evidence.revision++; }, copy => { copy[1].view.decision!.id = 'new-review'; },
    copy => { copy[1].policy = { ...policy, revision: 2 }; }, copy => { copy[1].view.eligibility = { usable: false, reason: 'source_unavailable' }; },
    copy => { copy[1].view.checkState = 'outdated'; }, copy => { copy[1].author = undefined; }, copy => { copy[1].author!.id = 'wrong-person'; },
  ];
  for (const mutate of mutations) { const copy = structuredClone(items); mutate(copy); assert.equal(prepareMemoryWriting(selection, copy, 'Artigo', ctx).ok, false); }
  assert.equal(prepareMemoryWriting(selection, items, ' ', ctx).ok, false);
  assert.equal(prepareMemoryWriting({ ...selection, items: [] }, items, 'Artigo', ctx).ok, false);
});
test('actual usage requires saved source references; removing a numeric qualifier or using unrelated matching words does not count', () => {
  const { source, body } = prepared(), edited = structuredClone(body);
  (edited.blocks[0] as ParagraphBlock).inlines[0].text = 'Foram atendidas 240 pessoas em 2025.';
  assert.equal(memoryWritingOccurrences(edited, source).length, 1);
  edited.blocks[0] = { ...body.blocks[0], sourceRefs: [] }; assert.equal(memoryWritingOccurrences(edited, source).length, 1);
  const foreign = structuredClone(body.blocks[0]); foreign.sourceRefs![0].sourceId = 'foreign-source'; edited.blocks[0] = foreign;
  assert.equal(memoryWritingOccurrences(edited, source).length, 1);
  assert.equal(memoryWritingOccurrences({ ...body, blocks: [] }, source).length, 0);
  assert.equal(memoryWritingOccurrences(body, { ...source, memory: undefined }).length, 0);
});
test('citation fragments keep exact source and article ranges and duplicated references do not inflate an occurrence', () => {
  const { source, body } = prepared(), quote = body.blocks[1] as QuoteBlock;
  const literal = items[1].view.evidence.anchor.excerpt, from = 8, to = literal.length - 1, fragment = literal.slice(from, to);
  quote.inlines = [{ text: `“${fragment}”` }];
  const ref = quote.sourceRefs![0]; if (ref.locator.type !== 'segment') throw new Error('segment');
  ref.locator.from = from; ref.locator.to = to; quote.sourceRefs!.push(structuredClone(ref));
  const article: ArticleBody = { ...body, blocks: [quote] }, occurrences = memoryWritingOccurrences(article, source);
  assert.equal(occurrences.length, 1); assert.equal(occurrences[0].from, 1); assert.equal(occurrences[0].to, 1 + fragment.length);
  assert.equal(occurrences[0].sourceFrom, from); assert.equal(occurrences[0].sourceTo, to);
  ref.sourceVersion++; quote.sourceRefs!.pop(); assert.equal(memoryWritingOccurrences(article, source).length, 0);
});
test('a derived writing collection never becomes a new independent bank origin through article reconciliation', () => {
  const { source, body } = prepared();
  const quotes = articleCitations(body, [source], { productionId: 'production', kind: 'piece', id: 'piece', storageHash: 'stored', bodyHash: articleHash(body), at: ctx.now });
  assert.ok(quotes.length > 0); assert.ok(quotes.every(quote => quote === null));
});
