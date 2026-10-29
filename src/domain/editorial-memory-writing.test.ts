import { validateMemoryArticle, validateMemoryWritingSources } from './editorial-memory-guard.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ArticleBody, ParagraphBlock, QuoteBlock } from './article.ts';
import { articleHash, blockText } from './article.ts';
import { articleCitations } from './editorial-memory-legacy.ts';
import { prepareMemoryWriting, memoryWritingOccurrences, memoryWritingProvenance, type MemoryWritingItem } from './editorial-memory-writing.ts';
import { createMemoryMaterial, memoryBlocks } from './editorial-memory-import.ts';
import { materializeMemoryCandidates, type MemoryCandidate } from './editorial-memory-extraction.ts';
import { initialMemoryPolicy, memoryEvidenceRef, memoryEligibility, reviewMemoryEvidence, type MemorySelection } from './editorial-memory.ts';
import { buildManifest } from './manifest.ts';
import { toVersionRef } from './piece.ts';
import { baseRecord, commitVersion, createKit, recordDecision } from './testing/scenario.ts';
import { memorySourceSegment, memoryWritingExcerpt } from './editorial-memory-excerpt.ts';
import { sourceContentHash } from './source.ts';
import { headingBlock, paragraphBlock, quoteBlock } from './article.ts';
import { listBlock } from './article.ts';
import { writingArticleBody } from './writing-article.ts';
import { writingSourceCandidates } from './writing-source.ts';
import { memoryArticleContentIssues } from './editorial-memory-article.ts';

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
test('writer candidates carry immutable selected proof and original metadata without unselected source content', () => {
  const { source } = prepared(), candidates = writingSourceCandidates([source]);
  assert.deepEqual(candidates.map(candidate => candidate.memory?.kind), ['statistic', 'citation']);
  assert.equal(candidates[0].speaker, undefined); assert.equal(candidates[1].speaker, source.speakers[0].label);
  assert.deepEqual(candidates.map(candidate => candidate.memory?.selected), selection.items);
  assert.deepEqual(candidates.map(candidate => candidate.memory?.origin), items.map(item => ({ source: item.view.evidence.anchor.source, spans: item.view.evidence.anchor.spans })));
  assert.ok(!JSON.stringify(candidates).includes('PRIVATE UNUSED'));
  candidates[0].memory!.selected.policyRevision = 999;
  assert.equal(source.memory[0].items[0].selected.policyRevision, 1, 'prompt preparation cannot mutate the collection snapshot');
  const malformed = structuredClone(source); malformed.memory[0].items.pop();
  assert.equal(validateMemoryWritingSources([malformed], items).ok, false, 'an incomplete binding cannot silently omit a selected item');
});
test('generated citation fragments acquire exact collection spans and preserve the selected decision', () => {
  const { source } = prepared(), text = items[1].view.evidence.anchor.excerpt, fragment = text.slice(8, -1);
  const candidate = writingSourceCandidates([source])[1];
  const article = { title: 'Synthetic fragment', dek: '', titleEvidenceIds: [candidate.key], dekEvidenceIds: [],
    blocks: [{ id: 'quote', type: 'quote' as const, level: 2 as const, text: fragment, items: [], evidenceIds: [candidate.key] }] };
  const body = writingArticleBody(article, 'run', () => [candidate.ref], [source]);
  assert.deepEqual(body.blocks[0].sourceRefs![0].locator, { type: 'segment', segmentId: 'memory-item-2', from: 8, to: text.length - 1 });
  assert.equal(validateMemoryArticle(body, [source], items).ok, true);
  assert.deepEqual(memoryWritingProvenance(body, [source])[0].selected, selection.items[1]);
  article.blocks[0].text = 'Words outside the selected original.';
  const invalid = writingArticleBody(article, 'run', () => [candidate.ref], [source]);
  assert.deepEqual(invalid.blocks[0].sourceRefs, [candidate.ref], 'invalid output retains its unresolved reference for review');
  assert.ok(memoryArticleContentIssues(invalid, [source]).length);
});
test('a complete numeric observation still cannot be turned into a direct quotation', () => {
  const { source, body } = prepared(), original = body.blocks[0], text = blockText(original);
  for (const block of [quoteBlock('spoken', text, { sourceRefs: original.sourceRefs }), paragraphBlock('inline-spoken', `“${text}”`, { sourceRefs: original.sourceRefs })]) {
    const result = validateMemoryArticle({ ...body, blocks: [block] }, [source], items);
    assert.ok(!result.ok); assert.equal(result.refusal.code, 'memory_literal_changed'); assert.ok(result.refusal.message.includes('fala'));
  }
  assert.equal(validateMemoryArticle({ ...body, blocks: [listBlock('complete', [text], false, { sourceRefs: original.sourceRefs })] }, [source], items).ok, true);
  assert.equal(validateMemoryArticle({ ...body, blocks: [headingBlock('heading', text, 2, { sourceRefs: original.sourceRefs })] }, [source], items).ok, false);
});
test('selecting a numeric fragment inserts its complete datum with exact usable provenance', () => {
  const { source, body } = prepared(), text = source.versions[0].content.segments[0].text, start = text.indexOf('240');
  const selected = memoryWritingExcerpt(source, 1, { segmentId: 'memory-item-1', start, end: start + 3, text: '240' });
  assert.ok(selected); assert.equal(selected.kind, 'statistic'); assert.equal(selected.text, text);
  assert.equal(selected.start, 0); assert.equal(selected.end, text.length);
  const inserted = { ...body, blocks: [paragraphBlock('manual-datum', selected.text, { sourceRefs: [selected.ref] })] };
  assert.equal(validateMemoryArticle(inserted, [source], items).ok, true);
  const occurrences = memoryWritingOccurrences(inserted, source);
  assert.equal(occurrences.length, 1); assert.equal(occurrences[0].sourceFrom, 0); assert.equal(occurrences[0].sourceTo, text.length);
  const partial = { ...body, blocks: [paragraphBlock('partial', '240', { sourceRefs: [selected.ref] })] };
  assert.equal(validateMemoryArticle(partial, [source], items).ok, false, 'a bare number cannot replace the datum');
});
test('bank citation insertion preserves whitespace and exact fragment offsets rather than normalizing the original', () => {
  const one = item('citation', 'Queremos  ouvir\ntodas as pessoas neste exemplo sintético.'), chosen = { ...selection, items: [{ evidence: memoryEvidenceRef(one.view.evidence), check: null, decisionId: one.view.decision!.id, policyRevision: 1 }] };
  const built = prepareMemoryWriting(chosen, [one], 'Literal whitespace', ctx); assert.ok(built.ok);
  const { source, body } = built.value, text = one.view.evidence.anchor.excerpt, start = 9, end = text.length - 1;
  const selected = memoryWritingExcerpt(source, 1, { segmentId: 'memory-item-1', start, end, text: text.slice(start, end) });
  assert.ok(selected); assert.equal(selected.kind, 'citation'); assert.equal(selected.text, text.slice(start, end));
  assert.ok(selected.text.includes('\n')); assert.deepEqual(selected.ref.locator, { type: 'segment', segmentId: 'memory-item-1', from: start, to: end });
  assert.equal(validateMemoryArticle({ ...body, blocks: [quoteBlock('manual-quote', selected.text, { sourceRefs: [selected.ref] })] }, [source], [one]).ok, true);
});
test('stale, forged, withdrawn and retired bank selections never become insertable excerpts', () => {
  const { source } = prepared(), selected = { segmentId: 'memory-item-1', start: 0, end: 5, text: 'Foram' };
  assert.ok(memoryWritingExcerpt(source, 1, selected));
  for (const change of [{ start: -1 }, { start: 0.5 }, { end: 0 }, { end: 9999 }, { text: 'False' }, { segmentId: 'missing' }])
    assert.equal(memoryWritingExcerpt(source, 1, { ...selected, ...change }), undefined);
  assert.equal(memoryWritingExcerpt({ ...source, rights: { authorized: false } }, 1, selected), undefined);
  const later = structuredClone(source); later.versions.push({ ...later.versions[0], number: 2 });
  assert.ok(memorySourceSegment(later, 1, selected.segmentId)); assert.equal(memoryWritingExcerpt(later, 1, selected), undefined);
  assert.equal(memorySourceSegment(later, 99, selected.segmentId), undefined);
  const changed = structuredClone(source); changed.versions[0].content.segments[0].text += ' Changed.';
  assert.equal(memorySourceSegment(changed, 1, selected.segmentId), undefined);
  changed.versions[0].hash = sourceContentHash(changed.versions[0].content);
  changed.memory![0].version.hash = changed.versions[0].hash;
  assert.equal(memorySourceSegment(changed, 1, selected.segmentId), undefined, 'a changed payload cannot inherit an old literal binding');
  const retired = structuredClone(source); retired.memory![0].retired = true;
  assert.equal(memoryWritingExcerpt(retired, 1, selected), undefined);
});
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

test('gated article usage retains exact actual proofs and refuses changed review, policy, rights and numeric context', () => {
  const { source, body } = prepared(), proof = validateMemoryArticle(body, [source], items);
  assert.ok(proof.ok); assert.equal(proof.value.length, 2); assert.deepEqual(proof.value[0].binding.selected, selection.items[0]);
  assert.equal(validateMemoryWritingSources([source], items).ok, true);
  for (const mutate of [
    (copy: MemoryWritingItem[]) => { copy[0].view.eligibility = { usable: false, reason: 'source_unavailable' }; },
    (copy: MemoryWritingItem[]) => { copy[0].view.evidence.revision++; },
    (copy: MemoryWritingItem[]) => { copy[0].view.decision!.id = 'replacement-decision'; },
    (copy: MemoryWritingItem[]) => { copy[0].view.checkState = 'outdated'; },
    (copy: MemoryWritingItem[]) => { copy[0].policy.workspaceId = 'foreign-workspace'; },
  ]) {
    const copy = structuredClone(items); mutate(copy);
    assert.equal(validateMemoryArticle(body, [source], copy).ok, false); assert.equal(validateMemoryWritingSources([source], copy).ok, false);
  }
  assert.equal(validateMemoryArticle(body, [{ ...source, rights: { ...source.rights, authorized: false } }], items).ok, false);
  const edited = structuredClone(body); (edited.blocks[0] as ParagraphBlock).inlines[0].text = 'Foram atendidas 240 pessoas em 2025.';
  const refused = validateMemoryArticle(edited, [source], items); assert.ok(!refused.ok); assert.equal(refused.refusal.code, 'memory_literal_changed');
  assert.equal(validateMemoryArticle({ ...body, blocks: [body.blocks[1]] }, [source], items.slice(1)).ok, true, 'Removed unused statistics do not block an unrelated approved citation');
});
test('each citation reference requires its own literal range and queued source versions remain exact', () => {
  const { source, body } = prepared(), quote = body.blocks[1] as QuoteBlock, text = items[1].view.evidence.anchor.excerpt;
  quote.inlines = [{ text: text.slice(0, 8) }]; quote.sourceRefs![0].locator = { type: 'segment', segmentId: 'memory-item-2', from: 0, to: 8 };
  assert.equal(validateMemoryArticle({ ...body, blocks: [quote] }, [source], items).ok, true);
  quote.sourceRefs!.push({ ...quote.sourceRefs![0], locator: { type: 'segment', segmentId: 'memory-item-2', from: 10, to: 20 } });
  assert.equal(validateMemoryArticle({ ...body, blocks: [quote] }, [source], items).ok, false);
  assert.equal(validateMemoryWritingSources([source], items, [{ kind: 'source-version', sourceId: source.id, sourceVersion: 9, hash: source.versions[0].hash }]).ok, false);
  const changed = structuredClone(source); changed.versions[0].content.segments[0].text = 'Changed after queueing';
  assert.equal(validateMemoryWritingSources([changed], items).ok, false);
});
test('delivered provenance follows the approved body and original source version instead of newer selections or unused excerpts', () => {
  const { source, body } = prepared(), approved = structuredClone(body), old = memoryWritingProvenance(approved, [source]);
  assert.equal(old.length, 2); assert.deepEqual(old[0].selected, selection.items[0]); assert.deepEqual(old[0].anchor, items[0].view.evidence.anchor);
  assert.equal(old[0].collection.source.sourceVersion, 1); assert.equal(old[0].collection.source.hash, source.versions[0].hash);
  assert.equal(old[0].article.to, items[0].view.evidence.anchor.excerpt.length); assert.equal(JSON.stringify(old).includes('PRIVATE UNUSED'), false);
  source.versions.push({ ...source.versions[0], number: 2 }); source.memory.push({ ...structuredClone(source.memory[0]), version: { ...source.memory[0].version, number: 2 }, selection: { ...source.memory[0].selection, revision: 2 } });
  assert.deepEqual(memoryWritingProvenance(approved, [source]), old);
  assert.equal(memoryWritingProvenance({ ...approved, blocks: [approved.blocks[1]] }, [source]).length, 1);
  assert.equal(memoryWritingProvenance({ ...approved, blocks: [approved.blocks[2]] }, [source]).length, 0);
  (body.blocks[0] as ParagraphBlock).inlines[0].text = 'Edited unapproved draft'; assert.deepEqual(memoryWritingProvenance(approved, [source]), old);
});
test('the delivered manifest binds actual bank occurrences to the exact approved version and its separate approver', () => {
  const { source, body } = prepared(), kit = createKit(), record = baseRecord(kit, { plan: ['article'] });
  record.sources = [source]; record.production.sourceIds = [source.id]; record.production.workspaceId = workspace;
  const version = commitVersion(record, kit, 'article', body), decision = recordDecision(record, kit, version, 'approved');
  const selection = [{ kind: 'article' as const, version: toVersionRef(version), decisionId: decision.id }];
  const manifest = buildManifest(record, selection, [], kit.now()), delivered = manifest.items[0];
  assert.equal(delivered.hash, version.hash); assert.equal(delivered.approvedBy, decision.by); assert.equal(delivered.approvedAt, decision.at);
  assert.deepEqual(delivered.memory, memoryWritingProvenance(body, [source])); assert.equal(delivered.memory?.length, 2);
  assert.deepEqual(delivered.memory?.[0].selected.evidence, items[0].view.decision?.evidence);
  record.pieces[0].draft.body = { type: 'article', title: 'New unapproved draft', blocks: [] };
  assert.deepEqual(buildManifest(record, selection, [], kit.now()).items[0].memory, delivered.memory);
});
