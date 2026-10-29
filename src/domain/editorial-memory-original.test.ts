import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memoryOriginalContext } from './editorial-memory-original.ts';
import { memoryWritingFixture } from './testing/editorial-memory.ts';
import { createMemoryMaterial } from './editorial-memory-import.ts';
import { toSourceVersionRef } from './source.ts';

let n = 0;
const ctx = { now: '2026-10-29T03:00:00Z', actorId: 'actor', newId: (prefix: string) => `${prefix}-${++n}` };
test('human original context resolves the selected immutable UTF16 anchor without trimming', () => {
  const text = 'Queremos  ouvir\n todas as pessoas 🐟 neste exemplo sintético.', prepared = memoryWritingFixture('citation', text, ctx);
  const anchor = prepared.item.view.evidence.anchor, metadata = prepared.item.view.evidence.metadata;
  const original = createMemoryMaterial({ title: 'Original', kind: 'report', text: 'BEFORE. ' + text + ' AFTER.', metadata, authorized: true, primaryOrigin: null, originalFileId: null }, 'workspace', ctx).source;
  const result = memoryOriginalContext(original, { ...anchor, source: toSourceVersionRef(original), spans: [{ segmentId: 'original', from: 8, to: 8 + text.length }] });
  assert.deepEqual(result, { before: 'BEFORE. ', excerpt: text, after: ' AFTER.' });
  assert.equal(memoryOriginalContext(original, anchor), undefined);
});
test('bounded context never splits a surrogate pair and does not expose an entire long original', () => {
  const text = 'Trecho literal sintético.', before = 'x'.repeat(30) + '🐟' + 'b'.repeat(999), after = 'a'.repeat(999) + '🐟' + 'y'.repeat(30);
  const metadata = { publishedOn: null, recordedOn: null, institution: null, company: null, event: null, edition: null, topics: [], originalUrl: null };
  const { source } = createMemoryMaterial({ title: 'Original', kind: 'report', text: before + text + after, metadata, authorized: true, primaryOrigin: null, originalFileId: null }, 'workspace', ctx);
  const result = memoryOriginalContext(source, { source: toSourceVersionRef(source), spans: [{ segmentId: 'original', from: before.length, to: before.length + text.length }], excerpt: text });
  assert.ok(result); assert.equal(result.excerpt, text); assert.equal(result.before.length, 999); assert.equal(result.after.length, 999);
  assert.ok(!/[\uD800-\uDFFF]/.test(result.before + result.after)); assert.ok(!result.before.includes('x')); assert.ok(!result.after.includes('y'));
});
