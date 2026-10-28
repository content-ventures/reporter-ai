import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MemoryCitation, MemorySupport } from '../domain/editorial-memory.ts';
import { initialMemoryPolicy } from '../domain/editorial-memory.ts';
import { createMemoryMaterial } from '../domain/editorial-memory-import.ts';
import { runMemoryCheck, type MemoryCheckProviders } from './editorial-memory-check-pipeline.ts';

const text = 'O dado sintético cresceu. A amostra sintética diminuiu.';
const now = '2026-10-28T19:00:00Z', ctx = { now, actorId: 'actor', newId: (prefix: string) => prefix };
const { material } = createMemoryMaterial({ title: 'Synthetic checker test', kind: 'report', text,
  metadata: { publishedOn: null, recordedOn: null, originalUrl: null, institution: null, company: null, event: null, edition: null, topics: [] },
  authorized: true, primaryOrigin: 'primary-original', originalFileId: null }, 'workspace', ctx);
const evidence: MemoryCitation = { id: 'quote', kind: 'citation', text, workspaceId: 'workspace', materialId: material.id, revision: 0,
  anchor: { source: material.source, spans: [{ segmentId: 'original', from: 0, to: text.length }], excerpt: text }, metadata: material.metadata,
  kinds: ['fact'], status: 'active', personId: 'person', authorConfirmed: true, legacyCitationId: null, supersedes: null, createdAt: now, updatedAt: now };
const source = (id: string): MemorySupport => ({ kind: 'external', url: `https://example.test/${id}`, title: id,
  excerpt: `Independent synthetic excerpt ${id}.`, retrievedAt: now, publishedOn: null, primaryOrigin: id });
const extracted = { overflow: false, claims: [
  { text: 'O dado sintético cresceu.', kind: 'fact', query: 'growth' },
  { text: 'A amostra sintética diminuiu.', kind: 'fact', query: 'sample' },
], strength: 3, strengthReason: 'Specific but synthetic.' };
function providers(judgement: unknown, extraction: unknown = extracted): MemoryCheckProviders & { calls: string[] } {
  let generates = 0; const calls: string[] = [];
  return { calls, now: () => now, generate: async () => ({ value: generates++ ? judgement : extraction, model: 'test-model', provider: 'synthetic' }),
    collect: async query => { calls.push(query); return [source(query)]; } };
}
const run = (deps: MemoryCheckProviders) => runMemoryCheck(evidence, material, initialMemoryPolicy('workspace'), null, 'test-model', 'actor', deps, new AbortController().signal);
test('numbered internal and external sources are scoped to each searched claim', async () => {
  const deps = providers({ supports: [
    { claim: 0, source: 0, relation: 'confirms' }, { claim: 1, source: 1, relation: 'contradicts' },
    { claim: 0, source: 1, relation: 'confirms' }, { claim: 0, source: 59, relation: 'confirms' },
  ] });
  const result = await run(deps);
  assert.equal(result.verdict, 'disputed'); assert.equal(result.confidence, null);
  assert.equal(result.provider, 'synthetic'); assert.equal(result.supports.length, 2);
  assert.equal(result.claims[0].sources[0].url, 'https://example.test/growth');
  assert.equal(result.claims[1].verdict, 'disputed'); assert.deepEqual(deps.calls.sort(), ['growth', 'sample']);
});
test('invalid literal claims and explicit overflow stop before searches', async () => {
  for (const input of [{ ...extracted, overflow: true }, { ...extracted, claims: [{ text: 'Invented words', kind: 'fact', query: 'bad' }] }]) {
    const deps = providers({ supports: [] }, input); await assert.rejects(run(deps), /MEMORY_CHECK_/); assert.equal(deps.calls.length, 0);
  }
});
test('empty searches stay unvalidated and opinions do not trigger searches', async () => {
  const empty = providers({ supports: [] }); empty.collect = async () => [];
  assert.equal((await run(empty)).verdict, 'not_validated');
  const opinion = providers({ supports: [] }, { ...extracted, claims: [{ text, kind: 'opinion', query: '' }] });
  assert.equal((await run(opinion)).verdict, 'not_checkable'); assert.equal(opinion.calls.length, 0);
});
test('provider errors and model drift never produce a successful check', async () => {
  const failed = providers({ supports: [] }); failed.collect = async () => { throw new Error('PROVIDER_REFUSED'); };
  await assert.rejects(run(failed), /PROVIDER_REFUSED/);
  const drift = providers({ supports: [] }); drift.generate = async () => ({ value: extracted, model: 'changed', provider: 'synthetic' });
  await assert.rejects(run(drift), /PIPELINE_SNAPSHOT_MISSING/);
});
test('a search hit with an unidentified original origin cannot create independent confirmation', async () => {
  const deps = providers({ supports: [{ claim: 0, source: 0, relation: 'confirms' }] });
  deps.collect = async () => [{ ...source('unverified-web-result'), originStatus: 'unverified' }];
  const checked = await run(deps); assert.equal(checked.verdict, 'not_validated'); assert.equal(checked.supports[0].relation, 'related');
});
