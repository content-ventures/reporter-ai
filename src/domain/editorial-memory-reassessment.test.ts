import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reassessMemoryPolicy } from './editorial-memory-reassessment.ts';
import { assessMemoryEvidence } from './editorial-memory-check.ts';
import { memoryWritingFixture } from './testing/editorial-memory.ts';
import { initialMemoryPolicy, memoryEvidenceRef, memoryDecisionApplies, type MemoryMaterial, type MemoryPolicy } from './editorial-memory.ts';
import { memoryPrecisionLowerBound } from './editorial-memory-calibration.ts';
const ctx = { actorId: 'actual-editor', now: '2026-10-29T13:00:00Z', newId: (prefix: string) => prefix };
function fixture() {
  const fixture = memoryWritingFixture('statistic', 'Cerca de 240 pessoas foram atendidas em 2025.', ctx), evidence = fixture.item.view.evidence;
  const material: MemoryMaterial = { ...fixture.item.view.material, workspaceId: evidence.workspaceId, revision: 1, source: evidence.anchor.source, metadata: evidence.metadata,
    importedAt: ctx.now, importedBy: ctx.actorId, originalFileId: null };
  const baseline = initialMemoryPolicy(evidence.workspaceId), check = assessMemoryEvidence(evidence, material, baseline, null, {
    claims: [{ text: evidence.anchor.excerpt, kind: 'declared' }], supports: [{ claim: 0, relation: 'confirms', evidence: { kind: 'external',
      url: 'https://independent.test/report', title: 'Synthetic original', excerpt: 'O levantamento independente confirmou o atendimento de 240 pessoas no período.',
      primaryOrigin: 'independent', retrievedAt: '2026-10-28T08:00:00Z', publishedOn: null } }], strength: null, provider: 'synthetic', model: 'synthetic',
  }, { ...ctx, now: '2026-10-28T09:00:00Z' });
  const policy: MemoryPolicy = { ...baseline, revision: 2, mode: 'calibrated', thresholds: { fact: null, declared: 80, opinion: null, forecast: null }, calibrationReportId: 'synthetic-report',
    calibration: { version: 'independent-confirmation-v1', bins: [{ key: 'one_origin', confirmed: 40, total: 40, confidence: Math.floor(memoryPrecisionLowerBound(40, 40)) }] } };
  return { evidence, material, baseline, check, policy, decision: fixture.item.view.decision,
    input: { evidence: memoryEvidenceRef(evidence), check: { id: check.id, revision: check.revision }, policyRevision: policy.revision, reason: 'Explicit synthetic policy reevaluation.' } };
}
test('policy reevaluation preserves the original factual proof/date/provider and records a separate actual actor and previous check', () => {
  const f = fixture(), before = structuredClone(f.check), evaluated = reassessMemoryPolicy(f.evidence, f.material, f.check, f.policy, f.input, ctx);
  assert.equal(evaluated.confidence, 91); assert.equal(evaluated.checkedAt, f.check.checkedAt); assert.equal(evaluated.policyRevision, 2); assert.equal(evaluated.revision, 2);
  assert.deepEqual(evaluated.supports, f.check.supports); assert.deepEqual(evaluated.claims, f.check.claims); assert.equal(evaluated.provider, f.check.provider);
  assert.deepEqual(evaluated.policyEvaluation, { check: f.input.check, previousPolicyRevision: 1, personId: ctx.actorId, at: ctx.now, reason: f.input.reason });
  assert.deepEqual(f.check, before); assert.equal(memoryDecisionApplies(f.evidence, f.policy, evaluated, f.decision), false);
  const restored = reassessMemoryPolicy(f.evidence, f.material, evaluated, { ...f.baseline, revision: 3 }, { ...f.input, check: { id: evaluated.id, revision: evaluated.revision }, policyRevision: 3 }, ctx);
  assert.equal(restored.confidence, null); assert.equal(restored.checkedAt, f.check.checkedAt); assert.equal(restored.policyEvaluation!.check.revision, 2);
});
test('a policy update cannot confirm disputed, unsupported or unverified factual observations', () => {
  const f = fixture();
  for (const verdict of ['disputed', 'not_validated', 'not_checkable'] as const) {
    const check = { ...structuredClone(f.check), verdict }; assert.equal(reassessMemoryPolicy(f.evidence, f.material, check, f.policy, f.input, ctx).confidence, null);
  }
  const unverified = structuredClone(f.check); unverified.supports[0].evidence.originStatus = 'unverified';
  assert.equal(reassessMemoryPolicy(f.evidence, f.material, unverified, f.policy, f.input, ctx).confidence, null);
  const unknown = { ...f.policy, calibration: { ...f.policy.calibration!, bins: [] } };
  assert.equal(reassessMemoryPolicy(f.evidence, f.material, f.check, unknown, f.input, ctx).confidence, null);
});
test('reassessment requires unchanged evidence, source, current policy, latest check and an explicit reason', () => {
  const f = fixture();
  for (const input of [{ ...f.input, evidence: { ...f.input.evidence, revision: 99 } }, { ...f.input, check: { ...f.input.check, revision: 99 } }, { ...f.input, policyRevision: 99 }])
    assert.throws(() => reassessMemoryPolicy(f.evidence, f.material, f.check, f.policy, input, ctx), /CONFLICT/);
  assert.throws(() => reassessMemoryPolicy({ ...f.evidence, status: 'withdrawn' }, f.material, f.check, f.policy, f.input, ctx), /CONFLICT/);
  assert.throws(() => reassessMemoryPolicy(f.evidence, { ...f.material, source: { ...f.material.source, sourceVersion: 2 } }, f.check, f.policy, f.input, ctx), /CONFLICT/);
  assert.throws(() => reassessMemoryPolicy(f.evidence, f.material, f.check, { ...f.policy, workspaceId: 'another' }, f.input, ctx), /CONFLICT/);
  assert.throws(() => reassessMemoryPolicy(f.evidence, f.material, { ...f.check, policyRevision: 2 }, f.policy, f.input, ctx), /CONFLICT/);
  assert.throws(() => reassessMemoryPolicy(f.evidence, f.material, f.check, f.policy, { ...f.input, reason: ' ' }, ctx), /REASON_REQUIRED/);
});
