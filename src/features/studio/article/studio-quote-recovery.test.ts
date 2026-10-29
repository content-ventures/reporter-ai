import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memoryWritingFixture } from '../../../domain/testing/editorial-memory.ts';
import { segmentRef } from '../../../domain/refs.ts';
import { sourceContentHash } from '../../../domain/source.ts';
import { closestExcerpt } from './studio-model.ts';

let n = 0;
const ctx = { now: '2026-10-29T03:00:00Z', actorId: 'actor', newId: (prefix: string) => `${prefix}-${++n}` };
const text = 'Queremos  ouvir\n todas as pessoas neste exemplo sintético.';
function bank() { return memoryWritingFixture('citation', text, ctx).source; }
test('news-kind bank citations provide exact recoverable whitespace and UTF16 offsets', () => {
  const source = bank(), segment = source.versions[0].content.segments[0], ref = segmentRef(source.id, 1, segment.id);
  const found = closestExcerpt({ text: 'Queremos escutar todas as pessoas neste exemplo sintético.', sourceRefs: [ref] }, [source]);
  assert.ok(found); assert.equal(found.text, text); assert.equal(found.readOnly, undefined);
  assert.equal(segment.text.slice(found.from, found.to), found.text); assert.deepEqual(found.ref.locator, { type: 'segment', segmentId: segment.id, from: 0, to: text.length });
});
test('explicit unknown origins cannot fall back to matching text in another collection', () => {
  const source = bank(), other = bank(), segment = source.versions[0].content.segments[0], ref = segmentRef(source.id, 1, segment.id);
  const quote = { text: 'Queremos escutar todas as pessoas neste exemplo sintético.', sourceRefs: [ref] };
  assert.equal(closestExcerpt(quote, [other]), undefined);
  assert.equal(closestExcerpt({ ...quote, sourceRefs: [{ ...ref, sourceVersion: 99 }] }, [source, other]), undefined);
  const found = closestExcerpt(quote, [other, source]); assert.equal(found?.ref.sourceId, source.id);
});
test('bank statistics never supply spoken-quote recovery even when their words match', () => {
  const source = memoryWritingFixture('statistic', 'Foram atendidas cerca de 240 pessoas em 2025.', ctx).source;
  assert.equal(closestExcerpt({ text: 'Foram atendidas 240 pessoas em 2025.', sourceRefs: [] }, [source]), undefined);
});
test('historical and withdrawn bank citations are marked read-only instead of adopting a latest version', () => {
  const source = bank(), segment = source.versions[0].content.segments[0], ref = segmentRef(source.id, 1, segment.id);
  const content = { type: 'transcript' as const, format: 'plain' as const, segments: [] }, hash = sourceContentHash(content);
  source.versions.push({ ...source.versions[0], number: 2, content, hash });
  source.memory!.push({ ...source.memory![0], version: { number: 2, hash }, items: [], retired: true });
  const found = closestExcerpt({ text, sourceRefs: [ref] }, [source]);
  assert.equal(found?.readOnly, true); assert.equal(found?.ref.sourceVersion, 1);
  source.rights.authorized = false;
  assert.equal(closestExcerpt({ text, sourceRefs: [ref] }, [source])?.readOnly, true);
  assert.equal(closestExcerpt({ text, sourceRefs: [] }, [source]), undefined);
});
