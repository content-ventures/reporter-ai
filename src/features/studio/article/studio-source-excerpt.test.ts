import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTranscriptSource, toSourceVersionRef } from '../../../domain/source.ts';
import { toSourceSummary } from '../../../domain/index.ts';
import { parseTranscript } from '../../../domain/text/transcript-parse.ts';
import type { SourceDetail } from '../../../ports/production-queries.ts';
import { studioSourceExcerpt } from './studio-source-excerpt.ts';

function detail(id: string, text: string): SourceDetail {
  const source = createTranscriptSource({ title: id, workspaceId: 'workspace', origin: 'other', authorized: true, parsed: parseTranscript(text) },
    { now: '2026-10-29T03:00:00Z', actorId: 'editor', newId: prefix => `${prefix}-${id}` });
  return { source, summary: toSourceSummary(source), version: source.versions[0], speakers: [], productions: [] };
}
const selection = (entry: SourceDetail) => ({ segmentId: entry.version.content.segments[0].id, start: 0,
  end: entry.version.content.segments[0].text.length, text: entry.version.content.segments[0].text });

test('assistant insertion keeps its own source and exact historical version despite an unrelated open pane', () => {
  const a = detail('a', 'Alpha is the open pane.'), b = detail('b', 'Beta is the referenced source.');
  assert.equal(a.version.content.segments[0].id, b.version.content.segments[0].id);
  b.source.versions.push({ ...b.version, number: 2, content: { ...b.version.content, segments: [{ ...b.version.content.segments[0], text: 'A newer source says something else.' }] } });
  const excerpt = studioSourceExcerpt([a, b], a, { ...selection(b), sourceId: b.source.id, sourceVersion: 1 });
  assert.ok(excerpt); assert.equal(excerpt.text, selection(b).text); assert.equal(excerpt.ref.sourceId, b.source.id);
  assert.equal(excerpt.ref.sourceVersion, 1); assert.equal(excerpt.kind, 'citation');
  for (const invalid of [{ sourceId: 'missing', sourceVersion: 1 }, { sourceId: b.source.id, sourceVersion: 99 }, { sourceId: b.source.id }, { sourceVersion: 1 }])
    assert.equal(studioSourceExcerpt([a, b], a, { ...selection(b), ...invalid }), undefined);
  assert.equal(studioSourceExcerpt(undefined, a, { ...selection(b), sourceId: b.source.id, sourceVersion: 1 }), undefined);
});

test('Material selection uses only the displayed version and refuses unrelated text or withdrawn rights', () => {
  const a = detail('a', 'Alpha is the open pane.');
  const excerpt = studioSourceExcerpt([a], a, selection(a)); assert.ok(excerpt);
  assert.equal(excerpt.sourceId, a.source.id); assert.equal(excerpt.sourceVersion, 1);
  assert.equal(studioSourceExcerpt([a], a, { ...selection(a), text: 'Unrelated text.' }), undefined);
  a.source.rights.authorized = false; assert.equal(studioSourceExcerpt([a], a, selection(a)), undefined);
});

test('bank statistics insert the complete selected observation and historical collections remain read-only', () => {
  const bank = detail('bank', 'Uma amostra sintética registrou cerca de 240 participantes em 2025.'), segment = bank.version.content.segments[0];
  bank.source.kind = 'news'; bank.source.memory = [{ selection: { id: 'selection', revision: 1 }, version: { number: 1, hash: bank.version.hash },
    items: [{ segmentId: segment.id, materialId: 'material', kind: 'statistic', anchor: { source: toSourceVersionRef(bank.source), excerpt: segment.text,
      spans: [{ segmentId: segment.id, from: 0, to: segment.text.length }] },
      metadata: { publishedOn: null, recordedOn: null, institution: null, company: null, event: null, edition: null, topics: [], originalUrl: null },
      selected: { evidence: { id: 'evidence', revision: 0, hash: '0000000000000000' }, check: null, decisionId: 'decision', policyRevision: 1 } }] }];
  const start = segment.text.indexOf('240'), selected = { segmentId: segment.id, start, end: start + 3, text: '240' };
  const excerpt = studioSourceExcerpt([bank], bank, selected); assert.ok(excerpt);
  assert.equal(excerpt.kind, 'statistic'); assert.equal(excerpt.text, segment.text);
  assert.deepEqual(excerpt.ref.locator, { type: 'segment', segmentId: segment.id, from: 0, to: segment.text.length });
  bank.source.versions.push({ ...bank.version, number: 2 });
  assert.equal(studioSourceExcerpt([bank], bank, selected), undefined);
});
