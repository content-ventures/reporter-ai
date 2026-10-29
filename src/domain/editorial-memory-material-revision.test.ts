import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryMaterial } from './editorial-memory-import.ts';
import { reviseMemoryMaterial } from './editorial-memory-material-revision.ts';
import { resolveMemoryAnchor } from './editorial-memory.ts';

const ctx = { actorId: 'editor', now: '2026-10-29T12:00:00Z', newId: (prefix: string) => prefix };
const metadata = { publishedOn: null, recordedOn: null, institution: null, company: null, event: null, edition: null, topics: [], originalUrl: null };
test('original correction preserves exact old/new whitespace, source identity, rights and historical anchors', () => {
  const text = '  Relato de teste com 240 pessoas.\r\nUma fala com 🐟 e é.', nextText = text.replace('240', '241');
  const first = createMemoryMaterial({ title: 'Synthetic original', kind: 'report', text, metadata, authorized: true, primaryOrigin: 'same-origin', originalFileId: null }, 'workspace', ctx);
  const original = structuredClone(first), revised = reviseMemoryMaterial(first.material, first.source, nextText, 'Corrected original count.', { ...ctx, actorId: 'reviewer' });
  assert.deepEqual(first, original); assert.deepEqual(revised.source.versions[0], original.source.versions[0]);
  assert.equal(revised.version.content.segments[0].text, nextText); assert.equal(revised.version.createdBy, 'reviewer');
  assert.equal(revised.version.note, 'Corrected original count.'); assert.equal(revised.material.source.sourceId, first.source.id);
  assert.equal(revised.material.source.sourceVersion, 2); assert.notEqual(revised.material.source.hash, first.material.source.hash);
  assert.deepEqual(revised.source.rights, first.source.rights); assert.deepEqual(revised.material.metadata, metadata);
  assert.equal(revised.material.primaryOrigin, first.material.primaryOrigin);
  assert.equal(resolveMemoryAnchor(revised.source, { source: first.material.source, spans: [{ segmentId: 'original', from: 0, to: text.length }], excerpt: text }), text);
  assert.throws(() => reviseMemoryMaterial(first.material, first.source, text, 'No change.', ctx), /MEMORY_NO_CHANGES/);
  assert.throws(() => reviseMemoryMaterial(first.material, revised.source, nextText + ' revised', 'Stale.', ctx), /MEMORY_CONFLICT/);
});
