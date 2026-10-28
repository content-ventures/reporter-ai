import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryMaterial, memoryBlocks } from './editorial-memory-import.ts';
import { materializeMemoryCandidates, memoryExtractionWindow, type MemoryCandidate } from './editorial-memory-extraction.ts';
import { resolveMemoryAnchor } from './editorial-memory.ts';
const ctx = { actorId: 'actor', now: '2026-10-28T17:00:00Z', newId: (prefix: string) => prefix };
const excerpt = 'Foram atendidas cerca de 240 pessoas em 2025.';
const original = 'a'.repeat(990) + excerpt + '😀 Conteúdo restante. '.repeat(60);
const created = createMemoryMaterial({ title: 'Synthetic', kind: 'report', text: original, metadata: { publishedOn: null, recordedOn: null, institution: null, company: null, event: null, edition: null, topics: [], originalUrl: null }, authorized: true, primaryOrigin: null, originalFileId: null }, 'workspace', ctx);
const blocks = memoryBlocks(created.material, 'job', original);
const candidate: MemoryCandidate = { kind: 'statistic', excerpt, from: 990, kinds: ['declared'], indicator: 'Pessoas atendidas', raw: '240', unit: 'pessoas', period: '2025', geography: null, population: null, qualifier: 'cerca de', issuingInstitution: null };
test('cross-boundary extraction belongs to one block and preserves raw value, qualifier and unknown attribution', () => {
  const result = materializeMemoryCandidates([candidate, candidate], blocks[0], created.material, memoryExtractionWindow(blocks[0], original), ctx);
  assert.equal(result.length, 1); assert.equal(resolveMemoryAnchor(created.source, result[0].anchor), excerpt);
  assert.equal(result[0].kind, 'statistic'); if (result[0].kind !== 'statistic') return;
  assert.deepEqual(result[0].value, { raw: '240', decimal: null, lower: null, upper: null, scale: null }); assert.equal(result[0].qualifier, 'cerca de');
  assert.deepEqual(materializeMemoryCandidates([candidate], blocks[1], created.material, memoryExtractionWindow(blocks[0], original), ctx), []);
  const citation = materializeMemoryCandidates([{ kind: 'citation', excerpt, from: 990, kinds: ['declared'] }], blocks[0], created.material, memoryExtractionWindow(blocks[0], original), ctx)[0];
  assert.equal(citation.kind, 'citation'); if (citation.kind === 'citation') { assert.equal(citation.personId, null); assert.equal(citation.authorConfirmed, false); }
});
test('paraphrases, invented context and ambiguous repeated words fail instead of becoming evidence', () => {
  assert.throws(() => materializeMemoryCandidates([{ ...candidate, excerpt: 'Foram atendidas 240 pessoas.' }], blocks[0], created.material, memoryExtractionWindow(blocks[0], original), ctx), /ANCHOR_INVALID/);
  assert.throws(() => materializeMemoryCandidates([{ ...candidate, geography: 'Brasil' }], blocks[0], created.material, memoryExtractionWindow(blocks[0], original), ctx), /CONTEXT_INVALID/);
  assert.throws(() => materializeMemoryCandidates([{ kind: 'citation', excerpt: 'aaa', from: null, kinds: ['opinion'] }], blocks[0], created.material, memoryExtractionWindow(blocks[0], original), ctx), /ANCHOR_INVALID/);
  for (const block of blocks) assert.ok(memoryExtractionWindow(block, original).text.isWellFormed());
});
