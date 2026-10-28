import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryMaterial, memoryBlocks } from './editorial-memory-import.ts';
import { resolveMemoryAnchor } from './editorial-memory.ts';

test('material import preserves raw Unicode/whitespace, unknown attribution and independent date fields across every block', () => {
  const text = `  ${'a'.repeat(997)}😀\r\nCafe\u0301 ${'  literal\n'.repeat(300)}  `;
  let id = 0;
  const input = { title: 'Synthetic original', kind: 'report' as const, text, metadata: { recordedOn: null, publishedOn: '2025-01-01',
    institution: null, company: null, event: null, edition: null, topics: [], originalUrl: null }, authorized: false, primaryOrigin: null, originalFileId: null };
  const created = createMemoryMaterial(input, 'workspace', { actorId: 'editor', now: '2026-01-01T00:00:00Z', newId: prefix => `${prefix}-${++id}` });
  const blocks = memoryBlocks(created.material, 'job', text);
  assert.equal(created.source.versions[0].content.segments[0].text, text); assert.deepEqual(created.source.speakers, []);
  assert.deepEqual(created.source.rights, { authorized: false }); assert.equal(created.source.recordedOn, undefined);
  assert.equal(created.material.metadata.recordedOn, null); assert.equal(created.material.metadata.publishedOn, '2025-01-01');
  assert.equal(blocks.map(block => block.anchor.excerpt).join(''), text);
  for (const [index, block] of blocks.entries()) {
    assert.ok(block.anchor.excerpt.length <= 1000); assert.equal(block.anchor.excerpt.isWellFormed(), true);
    assert.equal(resolveMemoryAnchor(created.source, block.anchor), block.anchor.excerpt);
    assert.equal(block.ordinal, index); assert.equal(block.anchor.spans[0].from, index ? blocks[index - 1].anchor.spans[0].to : 0);
  }
  const repeated = createMemoryMaterial(input, 'workspace', { actorId: 'other', now: '2026-02-01T00:00:00Z', newId: prefix => `${prefix}-${++id}` });
  assert.equal(created.material.primaryOrigin, repeated.material.primaryOrigin); assert.equal(created.material.source.hash, repeated.material.source.hash);
  assert.notEqual(created.material.source.sourceId, repeated.material.source.sourceId);
});
