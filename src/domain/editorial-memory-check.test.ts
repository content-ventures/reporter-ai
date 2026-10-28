import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessMemoryEvidence, type MemoryAssessment } from './editorial-memory-check.ts';
import { createMemoryMaterial } from './editorial-memory-import.ts';
import { initialMemoryPolicy, memoryEligibility } from './editorial-memory.ts';
import type { MemoryStatistic } from './editorial-memory.ts';
const text = 'Foram atendidas cerca de 240 pessoas fictícias em 2025.';
const ctx = { actorId: 'actor', now: '2026-10-28T19:00:00Z', newId: (prefix: string) => prefix };
const { material, source } = createMemoryMaterial({ title: 'Synthetic', kind: 'report', text, metadata: { publishedOn: null, recordedOn: null, institution: null, company: null, event: null, edition: null, topics: [], originalUrl: null }, authorized: true, primaryOrigin: 'original', originalFileId: null }, 'workspace', ctx);
const evidence: MemoryStatistic = { id: 'statistic', workspaceId: 'workspace', materialId: material.id, revision: 0, anchor: { source: material.source, spans: [{ segmentId: 'original', from: 0, to: text.length }], excerpt: text }, metadata: material.metadata, kinds: ['declared'], status: 'active', createdAt: ctx.now, updatedAt: ctx.now, supersedes: null, kind: 'statistic', indicator: 'Pessoas atendidas', value: { raw: '240', decimal: null, lower: null, upper: null, scale: null }, unit: 'pessoas', period: { label: '2025', from: null, to: null }, geography: null, population: 'pessoas fictícias', qualifier: 'cerca de', issuingInstitution: null, declaringPersonId: null };
const policy = initialMemoryPolicy('workspace');
const input: MemoryAssessment = { claims: [{ text, kind: 'declared', query: 'consulta neutra sintética' }], supports: [{ claim: 0, relation: 'confirms', evidence: { kind: 'external', url: 'https://example.test/primary', title: 'Synthetic independent primary', excerpt: 'O levantamento independente registrou aproximadamente 240 atendimentos de pessoas fictícias no ano de 2025.', retrievedAt: ctx.now, publishedOn: null, primaryOrigin: 'independent-primary' } }], strength: { score: 4, reason: 'Especificidade editorial, sem relação com confiança factual.' }, provider: 'synthetic-test', model: 'synthetic-model' };
test('known independent support validates the claim but never invents calibrated confidence or releases review', () => {
 const check = assessMemoryEvidence(evidence, material, policy, null, input, ctx);
 assert.equal(check.verdict, 'validated'); assert.equal(check.confidence, null); assert.equal(check.strength?.score, 4);
 assert.equal(memoryEligibility(evidence, source, policy, check, null).reason, 'review_required');
});
test('same-origin mirrors never supply independent confirmation and contradictions take precedence', () => {
 const mirror = structuredClone(input); mirror.supports[0].evidence.primaryOrigin = material.primaryOrigin;
 assert.equal(assessMemoryEvidence(evidence, material, policy, null, mirror, ctx).verdict, 'not_validated');
 const conflict = structuredClone(input); conflict.supports.push({ ...structuredClone(input.supports[0]), relation: 'contradicts' });
 const result = assessMemoryEvidence(evidence, material, policy, null, conflict, ctx); assert.equal(result.verdict, 'disputed');
 assert.equal(result.supports.length, 2); assert.equal(input.supports.length, 1);
});
test('invented claims and omitted numeric qualifiers fail rather than produce a completed check', () => {
 assert.throws(() => assessMemoryEvidence(evidence, material, policy, null, { ...input, claims: [{ text: 'Foram atendidas 999 pessoas.', kind: 'fact' }] }, ctx), /CLAIM_NOT_LITERAL/);
 assert.throws(() => assessMemoryEvidence(evidence, material, policy, null, { ...input, claims: [{ text: '240 pessoas fictícias em 2025', kind: 'declared' }] }, ctx), /STATISTIC_CONTEXT_MISSING/);
});

test('identical republications and the original publisher cannot corroborate themselves', () => {
 const copy = structuredClone(input); copy.supports[0].evidence.excerpt = text;
 assert.equal(assessMemoryEvidence(evidence, material, policy, null, copy, ctx).verdict, 'not_validated');
 const same = structuredClone(material); same.metadata.originalUrl = 'https://example.test/original';
 assert.equal(assessMemoryEvidence(evidence, same, policy, null, input, ctx).verdict, 'not_validated');
});
