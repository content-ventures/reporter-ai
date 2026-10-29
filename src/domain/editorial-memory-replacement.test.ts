import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replaceMemoryEvidence } from './editorial-memory-replacement.ts';
import { memoryWritingFixture } from './testing/editorial-memory.ts';
import { memoryDecisionApplies, memoryEvidenceRef } from './editorial-memory.ts';
let n = 0;
const ctx = { actorId: 'editor', now: '2026-10-29T06:00:00Z', newId: (prefix: string) => `${prefix}-${++n}` };
test('replaced statistics retain each original value/period/source and invalidate independent earlier decisions', () => {
  const a = memoryWritingFixture('statistic', 'Cerca de 240 pessoas foram atendidas em 2025.', ctx).item;
  const b = memoryWritingFixture('statistic', 'Cerca de 240 pessoas foram atendidas em 2026, após 2025.', ctx).item;
  if (b.view.evidence.kind === 'statistic') b.view.evidence.period = { label: '2026', from: null, to: null };
  b.view.decision = { ...b.view.decision!, evidence: memoryEvidenceRef(b.view.evidence) };
  assert.equal(memoryDecisionApplies(a.view.evidence, a.policy, null, a.view.decision), true);
  assert.equal(memoryDecisionApplies(b.view.evidence, b.policy, null, b.view.decision), true);
  const before = structuredClone([a.view.evidence, b.view.evidence]), result = replaceMemoryEvidence(a.view.evidence, b.view.evidence, 'New observation, independent review.', ctx);
  assert.deepEqual([a.view.evidence, b.view.evidence], before);
  for (const [index, evidence] of [result.previous, result.current].entries()) {
    assert.deepEqual(evidence.anchor, before[index].anchor);
    assert.equal(memoryDecisionApplies(evidence, index ? b.policy : a.policy, null, index ? b.view.decision : a.view.decision), false);
    if (evidence.kind === 'statistic' && before[index].kind === 'statistic') { assert.deepEqual(evidence.value, before[index].value); assert.deepEqual(evidence.period, before[index].period); }
  }
  assert.equal(result.previous.status, 'superseded'); assert.equal(result.current.status, 'active');
  assert.equal(memoryEvidenceRef(result.current).hash, memoryEvidenceRef(before[1]).hash, 'review invalidation is a context revision, not invented new data');
});
test('a corrected quotation must come from a later version of the same original', () => {
  const a = memoryWritingFixture('citation', 'Uma fala original sintética preservada integralmente.', ctx).item.view.evidence;
  const b = { ...structuredClone(a), id: 'corrected', anchor: { ...a.anchor, source: { ...a.anchor.source, sourceVersion: 2, hash: '0123456789abcdef' } } };
  assert.deepEqual(replaceMemoryEvidence(a, b, 'Corrected transcript.', ctx).previous.anchor, a.anchor);
  assert.throws(() => replaceMemoryEvidence(a, { ...b, anchor: a.anchor }, 'Same version.', ctx), /ORIGINAL/);
  assert.throws(() => replaceMemoryEvidence(a, { ...b, anchor: { ...b.anchor, source: { ...b.anchor.source, sourceId: 'unrelated' } } }, 'Unrelated quote.', ctx), /ORIGINAL/);
  assert.throws(() => replaceMemoryEvidence(a, b, '', ctx), /REASON/);
  assert.throws(() => replaceMemoryEvidence(a, { ...b, workspaceId: 'other' }, 'Foreign.', ctx), /INVALID/);
  assert.throws(() => replaceMemoryEvidence({ ...a, status: 'superseded' }, b, 'Already replaced.', ctx), /INVALID/);
});
