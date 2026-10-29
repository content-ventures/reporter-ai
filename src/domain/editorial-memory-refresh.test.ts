import assert from 'node:assert/strict';
import { test } from 'node:test';
import { articleHash, blockText } from './article.ts';
import { createMemoryMaterial, memoryBlocks } from './editorial-memory-import.ts';
import { materializeMemoryCandidates } from './editorial-memory-extraction.ts';
import { initialMemoryPolicy, memoryEvidenceRef, type MemorySelection } from './editorial-memory.ts';
import { validateMemoryArticle, validateMemoryWritingSources } from './editorial-memory-guard.ts';
import { refreshMemoryWriting } from './editorial-memory-refresh.ts';
import { prepareMemoryWriting, type MemoryWritingItem } from './editorial-memory-writing.ts';
import { sourceContentHash, toSourceVersionRef } from './source.ts';

let count = 0;
const context = { now: '2026-10-29T00:30:00Z', actorId: 'editor', newId: (prefix: string) => `${prefix}-${++count}` };
function item(kind: 'citation' | 'statistic', text: string): MemoryWritingItem {
  const metadata = { recordedOn: null, publishedOn: null, institution: null, company: null, event: null, edition: null, topics: [], originalUrl: null };
  const { material, source } = createMemoryMaterial({ title: 'Synthetic original', kind: 'report', text, authorized: true, metadata, primaryOrigin: null, originalFileId: null }, 'workspace', context);
  const common = { excerpt: text, from: 0, kinds: ['declared' as const] };
  const candidate = kind === 'citation' ? { ...common, kind } : { ...common, kind, indicator: 'Pessoas', raw: '240', unit: 'pessoas', period: '2025', geography: null, population: null, qualifier: 'cerca de', issuingInstitution: null };
  const evidence = materializeMemoryCandidates([candidate], memoryBlocks(material, 'job', text)[0], material, { from: 0, text }, context)[0];
  if (evidence.kind === 'citation') { evidence.personId = 'author'; evidence.authorConfirmed = true; }
  return { policy: initialMemoryPolicy('workspace'), ...(kind === 'citation' ? { author: { id: 'author', name: 'Autora sintética' } } : {}),
    view: { evidence, material, check: null, decision: { id: context.newId('decision'), workspaceId: 'workspace', sequence: 1, evidence: memoryEvidenceRef(evidence), check: null, policyRevision: 1,
      action: 'accept', reason: 'Synthetic original reviewed.', supports: [], personId: 'editor', at: context.now }, eligibility: { usable: source.rights.authorized, reason: 'ready' }, relevance: null,
      uses: { selected: 0, inserted: 0, approved: 0, published: 0 } } };
}
function selection(items: MemoryWritingItem[]): MemorySelection {
  return { id: context.newId('selection'), workspaceId: 'workspace', revision: 1, productionId: 'pauta', items: items.map(item => ({ evidence: memoryEvidenceRef(item.view.evidence),
    decisionId: item.view.decision!.id, check: null, policyRevision: 1 })), createdBy: 'editor', createdAt: context.now, updatedBy: 'editor', updatedAt: context.now };
}
function fixture() {
  const items = [item('statistic', 'Foram atendidas cerca de 240 pessoas em 2025.'), item('citation', 'Esta fala sintética conserva as palavras e a autoria do original.')];
  const prepared = prepareMemoryWriting(selection(items), items, 'Synthetic article', context); assert.ok(prepared.ok);
  return { ...prepared.value, items };
}

test('explicit refresh preserves earlier snapshots and words while rebasing unchanged evidence to the current review', () => {
  const { source, body, items } = fixture(), original = structuredClone({ source, body });
  const current = structuredClone(items); current[1].view.decision!.id = 'later-accepted-review';
  const ordered = [current[1], current[0]], chosen = selection(ordered);
  const result = refreshMemoryWriting(source, toSourceVersionRef(source), { selection: chosen, items: ordered }, body, true, 'Reviewed the later decision.', context); assert.ok(result.ok);
  const next = result.value;
  assert.deepEqual({ source, body }, original); assert.equal(next.source.id, source.id); assert.equal(next.source.createdAt, source.createdAt);
  assert.deepEqual(next.source.versions[0], source.versions[0]); assert.deepEqual(next.source.memory![0], source.memory![0]);
  assert.deepEqual(next.source.versions[1].content.segments.map(segment => segment.id), ['memory-item-2', 'memory-item-1']);
  assert.equal(next.source.versions[1].hash, sourceContentHash(next.source.versions[1].content));
  assert.deepEqual(next.body.blocks.map(blockText), body.blocks.map(blockText)); assert.equal(articleHash(next.body), articleHash(body));
  assert.equal(next.updatedReferences, 2); assert.deepEqual(next.concerns, []);
  assert.equal(validateMemoryWritingSources([next.source], current).ok, true); assert.equal(validateMemoryArticle(next.body, [next.source], current).ok, true);
  assert.equal(validateMemoryArticle(body, [next.source], current).ok, false, 'the frozen old body never silently acquires the later decision');
});

test('author changes append speaker mappings and leave affected draft words and references for review', () => {
  const { source, body, items } = fixture(), current = structuredClone(items), evidence = current[1].view.evidence;
  assert.equal(evidence.kind, 'citation'); if (evidence.kind !== 'citation') return;
  evidence.personId = 'new-author'; evidence.revision++; current[1].author = { id: 'new-author', name: 'Nova autora sintética' };
  current[1].view.decision = { ...current[1].view.decision!, id: 'corrected-author-review', evidence: memoryEvidenceRef(evidence) };
  const result = refreshMemoryWriting(source, toSourceVersionRef(source), { selection: selection(current), items: current }, body, true, 'Corrected attribution reviewed.', context); assert.ok(result.ok);
  assert.deepEqual(result.value.source.speakers[0], source.speakers[0]); assert.equal(result.value.source.speakers[1].personId, 'new-author');
  assert.deepEqual(result.value.body.blocks[1], body.blocks[1]); assert.equal(result.value.updatedReferences, 1);
  assert.deepEqual(result.value.concerns, [{ blockId: body.blocks[1].id, evidenceId: evidence.id, reason: 'changed' }]);
  const keep = refreshMemoryWriting(source, toSourceVersionRef(source), { selection: selection(items), items }, body, false, 'Keep draft references for manual review.', context); assert.ok(keep.ok);
  assert.deepEqual(keep.value.body, body); assert.ok(keep.value.concerns.every(concern => concern.reason === 'kept'));
});

test('removed and restored items keep their identities and new evidence never reuses another segment id', () => {
  const { source, body, items } = fixture();
  const removed = refreshMemoryWriting(source, toSourceVersionRef(source), { selection: selection([items[0]]), items: [items[0]] }, body, true, 'Remove the second item.', context); assert.ok(removed.ok);
  assert.equal(removed.value.concerns[0].reason, 'removed');
  const extra = item('statistic', 'Outra amostra sintética tinha cerca de 240 pessoas em 2025.'), next = [extra, items[1], items[0]];
  const restored = refreshMemoryWriting(removed.value.source, toSourceVersionRef(removed.value.source), { selection: selection(next), items: next }, body, true, 'Restore and extend the collection.', context); assert.ok(restored.ok);
  assert.deepEqual(restored.value.source.versions[2].content.segments.map(segment => segment.id), ['memory-item-3', 'memory-item-2', 'memory-item-1']);
  assert.deepEqual(restored.value.source.versions.slice(0, 2), removed.value.source.versions);
});

test('retirement excludes future provider input without changing past article proof or reviving revoked rights', () => {
  const { source, body } = fixture(); source.rights.authorized = false;
  const result = refreshMemoryWriting(source, toSourceVersionRef(source), null, body, true, 'Retire from future writing.', context); assert.ok(result.ok);
  const retired = result.value.source;
  assert.deepEqual(result.value.body, body); assert.equal(retired.rights.authorized, false); assert.equal(retired.memory!.at(-1)!.retired, true);
  assert.deepEqual(retired.versions.at(-1)!.content.segments, []); assert.equal(validateMemoryWritingSources([retired], []).ok, true);
  assert.equal(validateMemoryArticle(body, [retired], []).ok, false); assert.equal(refreshMemoryWriting(retired, toSourceVersionRef(retired), null, body, false, 'Again.', context).ok, false);
  const malformed = structuredClone(retired); malformed.memory!.at(-1)!.items = source.memory![0].items;
  assert.equal(validateMemoryWritingSources([malformed], []).ok, false);
});

test('stale versions, missing reasons and unavailable replacement evidence refuse without changing anything', () => {
  const { source, body, items } = fixture(), before = structuredClone({ source, body, items }), expected = toSourceVersionRef(source);
  assert.equal(refreshMemoryWriting(source, { ...expected, sourceVersion: 99 }, null, body, true, 'Reason.', context).ok, false);
  assert.equal(refreshMemoryWriting(source, expected, null, body, true, ' ', context).ok, false);
  const unavailable = structuredClone(items); unavailable[0].view.eligibility = { usable: false, reason: 'rejected' };
  assert.equal(refreshMemoryWriting(source, expected, { selection: selection(unavailable), items: unavailable }, body, true, 'Reason.', context).ok, false);
  assert.deepEqual({ source, body, items }, before);
});
