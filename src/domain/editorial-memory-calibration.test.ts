import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialMemoryPolicy, memoryEvidenceRef, type MemoryPolicy } from './editorial-memory.ts';
import { memoryWritingFixture } from './testing/editorial-memory.ts';
import { assessMemoryEvidence } from './editorial-memory-check.ts';
import { evaluateMemoryPolicy, memoryCalibrationBin, memoryCalibratedConfidence, memoryPrecisionLowerBound, type MemoryCalibrationCase } from './editorial-memory-calibration.ts';
import { activateMemoryPolicy, proposeMemoryPolicy } from './editorial-memory-policy.ts';
const policy = initialMemoryPolicy('workspace'), settings = { mode: 'calibrated' as const, thresholds: { fact: null, declared: 80, opinion: null, forecast: null } };
const criteria = { minTraining: 30, minValidation: 30, minOrigins: 10, minReleased: 30, minPrecision: 80, maxErrors: 0 };
let sequence = 0;
const ctx = { actorId: 'actual-reviewer', now: '2026-10-29T08:00:00Z', newId: (prefix: string) => `${prefix}-${++sequence}` };
function sample(index: number, split: 'training' | 'validation', purpose: 'technical' | 'editorial' = 'editorial') {
  const id = `${split}-${index}`, item: MemoryCalibrationCase = { id, workspaceId: 'workspace', evidence: { id, revision: 0, hash: '0123456789abcdef' }, check: { id, revision: 1 },
    source: { kind: 'source-version', sourceId: id, sourceVersion: 1, hash: 'fedcba9876543210' }, materialId: `material-${id}`, primaryOrigin: `original-${id}`,
    kinds: ['declared'], bin: 'one_origin', structurallyUsable: true, purpose, outcome: 'confirmed', reason: 'Synthetic evaluator test, not real quality acceptance.', personId: ctx.actorId, at: ctx.now };
  return { item, split };
}
const dataset = () => [...Array.from({ length: 40 }, (_, i) => sample(i, 'training')), ...Array.from({ length: 40 }, (_, i) => sample(i, 'validation'))];
test('measured confidence uses the Wilson lower endpoint and cannot turn a tiny or absent sample into certainty', () => {
  assert.equal(memoryPrecisionLowerBound(0, 1), 0); assert.equal(memoryPrecisionLowerBound(1, 0), 0);
  assert.ok(Math.abs(memoryPrecisionLowerBound(17, 20) - 63.958115) < 0.0001);
  assert.ok(memoryPrecisionLowerBound(1, 1) < 21); assert.ok(memoryPrecisionLowerBound(40, 40) < 100);
  assert.equal(memoryCalibratedConfidence('one_origin', { version: 'independent-confirmation-v1', bins: [{ key: 'one_origin', confirmed: 1, total: 1, confidence: 100 }] }), null);
  assert.equal(memoryCalibratedConfidence(null, { version: 'independent-confirmation-v1', bins: [] }), null);
});
test('held-out original groups and explicit measured criteria produce reproducible policy comparisons, not editorial-feedback labels', () => {
  const data = dataset(), report = evaluateMemoryPolicy(data, policy, settings, criteria);
  assert.equal(report.activatable, true); assert.deepEqual(report.blockers, []); assert.equal(report.calibration.bins[0].confidence, 91);
  assert.equal(report.metrics[1].released, 40); assert.equal(report.metrics[1].errors, 0); assert.equal(report.metrics[1].baselineReleased, 0);
  assert.equal(evaluateMemoryPolicy([...data].reverse(), policy, settings, criteria).datasetHash, report.datasetHash);
  const bad = dataset(); bad[41].item.outcome = 'contradicted'; assert.equal(evaluateMemoryPolicy(bad, policy, settings, criteria).activatable, false);
  const technical = data.map(item => ({ ...item, item: { ...item.item, purpose: 'technical' as const } }));
  assert.ok(evaluateMemoryPolicy(technical, policy, settings, criteria).blockers.includes('EDITORIAL_CORPUS_REQUIRED'));
  assert.throws(() => evaluateMemoryPolicy(data, policy, settings, null), /CRITERIA_INVALID/);
});
test('versions, mirror annotations and the same primary original cannot leak between splits or inflate measured certainty', () => {
  const leaked = dataset(); leaked[40].item.source.sourceId = leaked[0].item.source.sourceId;
  assert.ok(evaluateMemoryPolicy(leaked, policy, settings, criteria).blockers.includes('SOURCE_LEAKAGE'));
  const repeated = dataset(); for (const row of repeated.filter(row => row.split === 'training')) row.item.primaryOrigin = 'one-original';
  const report = evaluateMemoryPolicy(repeated, policy, settings, criteria); assert.equal(report.calibration.bins[0].total, 1); assert.ok(report.blockers.includes('INSUFFICIENT_ORIGINS'));
  assert.throws(() => evaluateMemoryPolicy([sample(0, 'training'), sample(0, 'training')], policy, settings, criteria), /DATASET_INVALID/);
  const foreign = dataset(); foreign[0].item.workspaceId = 'other'; assert.throws(() => evaluateMemoryPolicy(foreign, policy, settings, criteria), /DATASET_INVALID/);
});
test('scoring is based on independent verified support and never on strength, usage, same-publisher mirrors or a model probability', () => {
  const fixture = memoryWritingFixture('statistic', 'Cerca de 240 pessoas foram atendidas em 2025.', ctx), evidence = fixture.item.view.evidence;
  const material = { ...fixture.item.view.material, workspaceId: 'workspace', revision: 1, source: evidence.anchor.source, metadata: evidence.metadata, importedAt: ctx.now, importedBy: ctx.actorId, originalFileId: null };
  const input = { claims: [{ text: evidence.anchor.excerpt, kind: 'declared' as const }], supports: [{ claim: 0, relation: 'confirms' as const, evidence: { kind: 'external' as const,
    primaryOrigin: 'independent', excerpt: 'A separate independently checked synthetic statement.', title: 'Synthetic support', url: 'https://independent.test/report', retrievedAt: ctx.now, publishedOn: null } }], strength: null, provider: 'synthetic', model: 'synthetic' };
  const report = evaluateMemoryPolicy(dataset(), policy, settings, criteria), calibrated: MemoryPolicy = { ...policy, ...settings, calibrationReportId: 'measured-report', calibration: report.calibration };
  const checked = assessMemoryEvidence(evidence, material, calibrated, null, input, ctx); assert.equal(checked.confidence, 91); assert.equal(memoryCalibrationBin(evidence, material, checked), 'one_origin');
  const mirrors = structuredClone(input); mirrors.supports.push({ ...structuredClone(input.supports[0]), evidence: { ...input.supports[0].evidence, primaryOrigin: 'mirror', url: 'https://independent.test/mirror' } });
  assert.equal(memoryCalibrationBin(evidence, material, assessMemoryEvidence(evidence, material, calibrated, null, mirrors, ctx)), 'one_origin');
  const unknown = structuredClone(input); Object.assign(unknown.supports[0].evidence, { originStatus: 'unverified' });
  assert.equal(assessMemoryEvidence(evidence, material, calibrated, null, unknown, ctx).confidence, null);
  assert.deepEqual(checked.evidence, memoryEvidenceRef(evidence)); assert.equal(assessMemoryEvidence(evidence, material, policy, null, input, ctx).confidence, null);
});
test('activation and restoration always create another policy revision while keeping the original snapshots intact', () => {
  const input = { baseRevision: 1, settings: { mode: 'review_required' as const, thresholds: policy.thresholds }, criteria: null, cases: [], reason: 'Explicit initial manual policy.' };
  const proposal = proposeMemoryPolicy(input, [], policy, null, ctx), activated = activateMemoryPolicy(proposal, policy, 'Activate reviewed policy.', ctx);
  assert.equal(activated.revision, 2); assert.equal(activated.activatedBy, ctx.actorId); assert.equal(policy.revision, 1); assert.equal(policy.activatedAt, null);
  const restored = activateMemoryPolicy(proposeMemoryPolicy({ ...input, baseRevision: 2 }, [], activated, 1, ctx), activated, 'Restore baseline without deleting newer data.', ctx);
  assert.equal(restored.revision, 3); assert.equal(restored.change!.restoredFrom, 1); assert.equal(activated.revision, 2);
  assert.throws(() => activateMemoryPolicy(proposal, activated, 'Stale activation refused.', ctx), /CONFLICT/);
  const data = dataset().map(row => ({ ...row, item: { ...row.item, purpose: 'technical' as const } }));
  const technical = proposeMemoryPolicy({ baseRevision: 1, settings, criteria, cases: data.map(row => ({ id: row.item.id, split: row.split })), reason: 'Technical test only.' }, data.map(row => row.item), policy, null, ctx);
  assert.throws(() => activateMemoryPolicy(technical, policy, 'No real corpus.', ctx), /NOT_EVALUATED/);
});
