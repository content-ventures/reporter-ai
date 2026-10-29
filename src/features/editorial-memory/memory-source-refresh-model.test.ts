import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryMaterial, memoryBlocks } from '../../domain/editorial-memory-import.ts';
import { materializeMemoryCandidates } from '../../domain/editorial-memory-extraction.ts';
import { initialMemoryPolicy, memoryEvidenceRef } from '../../domain/editorial-memory.ts';
import type { MemoryDetail } from '../../ports/editorial-memory.ts';
import { currentRefreshItem, sameRefreshItem } from './memory-source-refresh-model.ts';
import { captureMemoryChoice } from '../../domain/editorial-memory-discovery.ts';

function detail(): MemoryDetail {
  let sequence = 0;
  const context = { actorId: 'editor', now: '2026-10-29T01:00:00Z', newId: (prefix: string) => `${prefix}-${++sequence}` };
  const text = 'A amostra sintética tinha cerca de 240 pessoas em 2025.', metadata = { recordedOn: null, publishedOn: null, institution: null, company: null, event: null, edition: null, topics: [], originalUrl: null };
  const { material, source } = createMemoryMaterial({ title: 'Synthetic report', kind: 'report', text, authorized: true, metadata, primaryOrigin: null, originalFileId: null }, 'workspace', context);
  const evidence = materializeMemoryCandidates([{ kind: 'statistic', kinds: ['declared'], excerpt: text, from: 0, indicator: 'Amostra', raw: '240', unit: 'pessoas', period: '2025', geography: null, population: null, qualifier: 'cerca de', issuingInstitution: null }],
    memoryBlocks(material, 'job', text)[0], material, { from: 0, text }, context)[0];
  const page = { items: [], nextCursor: null, total: 0, snapshot: 'synthetic' };
  return { evidence, material, policy: initialMemoryPolicy('workspace'), check: null, decision: { id: 'review-1', workspaceId: 'workspace', sequence: 1, evidence: memoryEvidenceRef(evidence),
    check: null, policyRevision: 1, action: 'accept', reason: 'Synthetic original reviewed.', supports: [], personId: 'editor', at: context.now }, eligibility: { usable: true, reason: 'ready' }, relevance: null,
    uses: { selected: 0, inserted: 0, approved: 0, published: 0 }, source: { ref: material.source, authorized: true, segments: source.versions[0].content.segments }, checks: page, decisions: page, revisions: page, occurrences: page };
}

test('a refresh must acknowledge a later accepted review even when the visible excerpt is unchanged', () => {
  const current = detail(), displayed = currentRefreshItem(current);
  assert.equal(displayed.decisionId, 'review-1'); assert.equal(sameRefreshItem(displayed, currentRefreshItem(structuredClone(current))), true);
  current.decision = { ...current.decision!, id: 'review-2', sequence: 2 };
  assert.equal(current.evidence.anchor.excerpt, detail().evidence.anchor.excerpt);
  assert.equal(sameRefreshItem(displayed, currentRefreshItem(current)), false, 'a concurrent selection response cannot silently replace the displayed decision');
  assert.equal(sameRefreshItem(displayed, { ...displayed, check: { id: 'check', revision: 2 } }), false);
});

test('an old decision is not carried into a corrected evidence or a later policy', () => {
  const current = detail(), displayed = currentRefreshItem(current); current.evidence.revision++;
  assert.equal(currentRefreshItem(current).decisionId, null); assert.equal(sameRefreshItem(displayed, currentRefreshItem(current)), false);
  current.decision = { ...current.decision!, evidence: memoryEvidenceRef(current.evidence) };
  assert.equal(currentRefreshItem(current).decisionId, 'review-1'); current.policy.revision++;
  assert.equal(currentRefreshItem(current).decisionId, null); assert.equal(sameRefreshItem(displayed, currentRefreshItem(current)), false);
});
test('refresh preserves the original discovery revision and checks that saved search context was not dropped', () => {
  const current = detail(), displayed = { ...currentRefreshItem(current), discovery: captureMemoryChoice(current.evidence, { query: '240' }, '10').discovery! };
  const next = currentRefreshItem(current, displayed); assert.equal(sameRefreshItem(displayed, next), true);
  assert.equal(sameRefreshItem(displayed, currentRefreshItem(current)), false);
  current.evidence.revision++; const corrected = currentRefreshItem(current, displayed);
  assert.equal(corrected.discovery!.evidence.revision, displayed.evidence.revision);
  assert.equal(corrected.evidence.revision, displayed.evidence.revision + 1);
});
