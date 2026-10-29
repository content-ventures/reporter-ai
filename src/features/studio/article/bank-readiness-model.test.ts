import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MemoryWritingStatus } from '../../../ports/editorial-memory.ts';
import { bankWritingReadiness, type BankWritingSnapshot } from './bank-readiness-model.ts';

const snapshot: BankWritingSnapshot = { productionId: 'pauta', updatedAt: '2026-10-28T20:00:00Z', sources: [
  { kind: 'source-version', sourceId: 'collection-a', sourceVersion: 1, hash: 'hash-a' },
  { kind: 'source-version', sourceId: 'collection-b', sourceVersion: 2, hash: 'hash-b' },
] };
const status: MemoryWritingStatus = { ...snapshot, checkedAt: '2026-10-28T20:01:00Z', issues: [] };

test('bank readiness requires the exact pauta and every immutable attached collection', () => {
  assert.equal(bankWritingReadiness(snapshot, undefined).reason, 'Conferindo as evidências do banco.');
  assert.deepEqual(bankWritingReadiness(snapshot, status), { reason: null });
  assert.deepEqual(bankWritingReadiness(snapshot, { ...status, sources: [...status.sources].reverse() }), { reason: null });
  for (const changed of [
    { ...status, productionId: 'other' }, { ...status, updatedAt: 'later' }, { ...status, sources: status.sources.slice(0, 1) },
    { ...status, sources: [...status.sources, status.sources[0]] },
    { ...status, sources: status.sources.map((ref, index) => index ? { ...ref, sourceVersion: 3 } : ref) },
    { ...status, sources: status.sources.map((ref, index) => index ? { ...ref, hash: 'changed' } : ref) },
  ]) assert.ok(bankWritingReadiness(snapshot, changed).reason);
  assert.deepEqual(bankWritingReadiness({ ...snapshot, sources: [] }, undefined), { reason: null });
});

test('a current source refusal remains actionable and a foreign issue cannot open another source', () => {
  const issue = { source: snapshot.sources[1], code: 'memory_review_changed' as const, message: 'Atualize a seleção antes de escrever.' };
  assert.deepEqual(bankWritingReadiness(snapshot, { ...status, issues: [issue] }), { reason: issue.message, issue });
  const result = bankWritingReadiness(snapshot, { ...status, issues: [{ ...issue, source: { ...issue.source, sourceId: 'other-workspace' } }] });
  assert.ok(result.reason); assert.equal(result.issue, undefined);
});
