import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialMemoryPolicy, memoryDecisionApplies, memoryEligibility, memoryEvidenceRef, resolveMemoryAnchor, reviewMemoryEvidence } from './editorial-memory.ts';
import type { MemoryAnchor, MemoryCheck, MemoryCitation, MemoryDecisionInput, MemoryEvidenceBase, MemoryMetadata, MemoryStatistic } from './editorial-memory.ts';
import { createTranscriptSource, toSourceVersionRef } from './source.ts';
import { parseTranscript } from './text/transcript-parse.ts';
import type { Member, Role } from './workspace.ts';

const ctx = { actorId: 'member', now: '2026-10-28T12:00:00Z', newId: () => 'decision-1' };
const metadata: MemoryMetadata = { publishedOn: null, recordedOn: null, institution: null, company: null, event: null,
  edition: null, topics: [], originalUrl: null };
function setup() {
  const source = createTranscriptSource({ workspaceId: 'workspace', title: 'Synthetic source', origin: 'interview', authorized: true,
    parsed: parseTranscript('Ana Exemplo: A unidade sintética treinou 240 pessoas em 2025.\nBruno Exemplo: Agradecemos a participação de todos os presentes.', { format: 'speaker-lines' }),
    speakerPeople: { 'Ana Exemplo': 'ana' } }, { ...ctx, newId: () => 'source' });
  const segment = source.versions[0].content.segments[0];
  const anchor: MemoryAnchor = { source: toSourceVersionRef(source), spans: [{ segmentId: segment.id, from: 0, to: segment.text.length }], excerpt: segment.text };
  const base: MemoryEvidenceBase = { id: 'evidence', workspaceId: 'workspace', materialId: 'material', revision: 1, anchor, metadata,
    kinds: ['declared'], status: 'active', createdAt: ctx.now, updatedAt: ctx.now, supersedes: null };
  const evidence: MemoryCitation = { ...base,
    kind: 'citation', text: anchor.excerpt, personId: 'ana', authorConfirmed: true, legacyCitationId: null };
  const policy = initialMemoryPolicy('workspace', ctx);
  const member: Member = { workspaceId: 'workspace', personId: 'member', roles: ['editor'] };
  const factSource = { url: 'https://source.invalid/synthetic-report', title: 'Synthetic report', site: 'source.invalid', excerpt: anchor.excerpt };
  const check: MemoryCheck = { id: 'check', workspaceId: 'workspace', revision: 1, evidence: memoryEvidenceRef(evidence), policyRevision: 1,
    checkedAt: ctx.now, verdict: 'validated', confidence: 100,
    claims: [{ text: anchor.excerpt, kind: 'declared', verdict: 'validated', sources: [factSource] }],
    supports: [{ claim: 0, relation: 'confirms', evidence: { kind: 'external', ...factSource,
      retrievedAt: ctx.now, publishedOn: null, primaryOrigin: factSource.url } }],
    strength: { score: 5, reason: 'Synthetic' }, provider: null, model: null };
  const input: MemoryDecisionInput = { evidence: memoryEvidenceRef(evidence), check: { id: check.id, revision: check.revision },
    policyRevision: policy.revision, previousSequence: 0, action: 'accept', reason: 'Conferi o trecho e seu contexto.', supports: [] };
  return { source, evidence, base, anchor, policy, member, check, input };
}

test('all four workspace roles may review evidence and the append-only decision names its actual author', () => {
  for (const role of ['editor', 'approver', 'creative_reviewer', 'admin'] as Role[]) {
    const { evidence, source, policy, check, input, member } = setup();
    const result = reviewMemoryEvidence(input, evidence, source, policy, check, null, { ...member, roles: [role] }, ctx);
    assert.equal(result.ok, true, role);
    if (!result.ok) continue;
    assert.equal(result.value.personId, ctx.actorId);
    assert.equal(result.value.at, ctx.now);
    assert.equal(result.value.sequence, 1);
    assert.equal(result.value.reason, input.reason);
    assert.equal(memoryDecisionApplies(evidence, policy, check, result.value), true);
    assert.deepEqual(memoryEligibility(evidence, source, policy, check, result.value), { usable: true, reason: 'ready' });
    assert.equal(check.claims[0].verdict, 'validated', 'review does not overwrite the check');
  }
});

test('another workspace, an invented actor, an absent membership and read-only inspection cannot review', () => {
  const { evidence, source, policy, check, input, member } = setup();
  for (const candidate of [undefined, { ...member, workspaceId: 'other' }, { ...member, personId: 'other' },
    { ...member, readOnly: true as const }, { ...member, roles: [] }]) {
    const result = reviewMemoryEvidence(input, evidence, source, policy, check, null, candidate, ctx);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.refusal.code, 'forbidden');
  }
});

test('reviews require a reason and exact evidence, check, policy and preceding decision revisions', () => {
  const { evidence, source, policy, check, input, member } = setup();
  for (const changed of [
    { ...input, evidence: { ...input.evidence, revision: 0 } }, { ...input, evidence: { ...input.evidence, hash: 'forged' } },
    { ...input, check: { id: check.id, revision: 2 } }, { ...input, check: null }, { ...input, policyRevision: 2 },
    { ...input, previousSequence: 1 },
  ]) {
    const result = reviewMemoryEvidence(changed, evidence, source, policy, check, null, member, ctx);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.refusal.code, 'conflict');
  }
  assert.equal(reviewMemoryEvidence({ ...input, reason: ' ' }, evidence, source, policy, check, null, member, ctx).ok, false);
  assert.equal(reviewMemoryEvidence({ ...input, reason: 'x'.repeat(2001) }, evidence, source, policy, check, null, member, ctx).ok, false);
});

test('a decision cannot authorize withdrawn sources, unknown authors or fabricated quotations', () => {
  const { evidence, source, policy, check, input, member } = setup();
  assert.equal(reviewMemoryEvidence(input, evidence, { ...source, rights: { authorized: false } }, policy, check, null, member, ctx).ok, false);
  for (const changed of [{ ...evidence, authorConfirmed: false }, { ...evidence, personId: null },
    { ...evidence, text: 'A fonte nunca disse esta frase inventada.' }, { ...evidence, status: 'withdrawn' as const }]) {
    const next = { ...input, evidence: memoryEvidenceRef(changed), check: null };
    assert.equal(reviewMemoryEvidence(next, changed, source, policy, null, null, member, ctx).ok, false);
  }
});

test('a recheck, metadata correction or changed policy invalidates the prior acceptance', () => {
  const { evidence, source, policy, check, input, member } = setup();
  const reviewed = reviewMemoryEvidence(input, evidence, source, policy, check, null, member, ctx);
  assert.ok(reviewed.ok);
  assert.equal(memoryDecisionApplies(evidence, policy, { ...check, revision: 2 }, reviewed.value), false);
  assert.equal(memoryDecisionApplies({ ...evidence, metadata: { ...metadata, recordedOn: '2025-01-01' } }, policy, check, reviewed.value), false);
  assert.equal(memoryDecisionApplies(evidence, { ...policy, revision: 2 }, check, reviewed.value), false);
  const rejected = reviewMemoryEvidence({ ...input, previousSequence: 1, action: 'reject', reason: 'O contexto não sustenta o uso.' },
    evidence, source, policy, check, reviewed.value, member, { ...ctx, newId: () => 'decision-2' });
  assert.ok(rejected.ok);
  assert.equal(rejected.value.sequence, 2);
  assert.equal(reviewed.value.action, 'accept', 'the previous audit record remains immutable');
  assert.equal(memoryEligibility(evidence, source, policy, check, rejected.value).reason, 'rejected');
});

test('uncalibrated confidence and disputed or unvalidated facts never bypass human review', () => {
  const { evidence, source, policy, check } = setup();
  assert.equal(memoryEligibility(evidence, source, policy, check, null).reason, 'review_required');
  const calibrated = { ...policy, mode: 'calibrated' as const, calibrationReportId: 'measured-report',
    thresholds: { fact: 80, declared: 85, opinion: 80, forecast: 80 } };
  assert.equal(memoryEligibility(evidence, source, calibrated, check, null).usable, true);
  for (const verdict of ['disputed', 'not_validated', 'pending'] as const)
    assert.equal(memoryEligibility(evidence, source, calibrated, { ...check, verdict }, null).usable, false);
  for (const confidence of [null, -1, 101, NaN, 84])
    assert.equal(memoryEligibility(evidence, source, calibrated, { ...check, confidence }, null).usable, false);
  assert.equal(memoryEligibility(evidence, source, calibrated, { ...check, claims: [] }, null).usable, false);
  assert.equal(memoryEligibility(evidence, source, calibrated, { ...check, supports: [] }, null).usable, false);
  assert.equal(memoryEligibility(evidence, source, calibrated, { ...check, supports: check.supports.map(support => ({ ...support, relation: 'contradicts' })) }, null).usable, false);
});

test('anchors retain cross-segment words and reject skipped context, changed hashes and invalid offsets', () => {
  const { source, anchor } = setup();
  assert.equal(resolveMemoryAnchor(source, anchor), anchor.excerpt);
  const segments = source.versions[0].content.segments;
  const full: MemoryAnchor = { source: anchor.source, spans: segments.map(segment => ({ segmentId: segment.id, from: 0, to: segment.text.length })),
    excerpt: segments.map(segment => segment.text).join('\n') };
  assert.equal(resolveMemoryAnchor(source, full), full.excerpt);
  assert.equal(resolveMemoryAnchor(source, { ...full, spans: full.spans.map((span, index) => index ? { ...span, from: 1 } : span) }), undefined);
  assert.equal(resolveMemoryAnchor(source, { ...anchor, source: { ...anchor.source, hash: 'changed' } }), undefined);
  for (const from of [-1, 0.5, Infinity]) assert.equal(resolveMemoryAnchor(source, { ...anchor, spans: [{ ...anchor.spans[0], from }] }), undefined);
  assert.equal(resolveMemoryAnchor(source, { ...anchor, excerpt: `${anchor.excerpt} invented` }), undefined);
  assert.equal(resolveMemoryAnchor(source, { ...anchor, spans: [] }), undefined);
});

test('statistics can be reviewed without a speaker, but raw numbers, units and qualifiers must exist in the original', () => {
  const { base, source, policy, input, member } = setup();
  const statistic: MemoryStatistic = { ...base, kind: 'statistic', indicator: 'Pessoas treinadas',
    value: { raw: '240', decimal: '240', lower: null, upper: null, scale: null }, unit: 'pessoas',
    period: { label: '2025', from: '2025-01-01', to: '2025-12-31' }, geography: null, population: null,
    qualifier: null, issuingInstitution: null, declaringPersonId: null };
  const request = { ...input, evidence: memoryEvidenceRef(statistic), check: null };
  const result = reviewMemoryEvidence(request, statistic, source, policy, null, null, member, ctx);
  assert.ok(result.ok);
  assert.equal(memoryEligibility(statistic, source, policy, null, result.value).usable, true);
  for (const changed of [{ ...statistic, value: { ...statistic.value, raw: '999' } },
    { ...statistic, unit: 'toneladas' }, { ...statistic, qualifier: 'aproximadamente' }]) {
    assert.equal(reviewMemoryEvidence({ ...request, evidence: memoryEvidenceRef(changed) }, changed, source, policy, null, null, member, ctx).ok, false);
  }
});
