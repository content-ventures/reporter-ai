import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { segmentRef } from './refs.ts';
import {
  createTranscriptSource,
  currentSourceVersion,
  findDuplicateSource,
  mapSpeaker,
  resolveSourceRef,
  reviseSource,
  sourceContentHash,
  toSourceVersionRef,
} from './source.ts';
import { createKit, JOAO, SAMPLE_TRANSCRIPT, sampleSource, WORKSPACE } from './testing/scenario.ts';
import { parseTranscript } from './text/transcript-parse.ts';

describe('transcript source', () => {
  test('is created with version 1, hashed content, speakers mapped to people and rights', () => {
    const kit = createKit();
    const source = sampleSource(kit);
    const version = currentSourceVersion(source);
    assert.equal(source.kind, 'transcript');
    assert.equal(version.number, 1);
    assert.equal(version.hash, sourceContentHash(version.content));
    assert.deepEqual(source.speakers, [{ label: 'Entrevistadora' }, { label: 'Marina Lopes', personId: 'person-marina' }]);
    assert.deepEqual(source.rights, { authorized: true, authorizedBy: JOAO, authorizedAt: '2026-10-07T12:00:00.000Z' });
    assert.deepEqual(toSourceVersionRef(source), { kind: 'source-version', sourceId: source.id, sourceVersion: 1, hash: version.hash });
  });

  test('unauthorised material records no authoriser', () => {
    const source = sampleSource(createKit(), false);
    assert.deepEqual(source.rights, { authorized: false });
  });

  test('the same material is detected as duplicate by hash', () => {
    const kit = createKit();
    const existing = sampleSource(kit);
    const parsed = parseTranscript(SAMPLE_TRANSCRIPT);
    const hash = sourceContentHash({ type: 'transcript', format: parsed.format, segments: parsed.segments });
    assert.equal(findDuplicateSource([existing], hash)?.id, existing.id);
    const other = parseTranscript('Ana: Outra conversa.\nBia: Sim.');
    assert.equal(findDuplicateSource([existing], sourceContentHash({ type: 'transcript', format: other.format, segments: other.segments })), undefined);
  });

  test('references resolve to the exact excerpt and speaker, or not at all', () => {
    const source = sampleSource(createKit());
    const resolved = resolveSourceRef([source], segmentRef(source.id, 1, 'seg-004', { from: 0, to: 19 }));
    assert.equal(resolved?.excerpt, 'A feira mudou tudo.');
    assert.deepEqual(resolved?.speaker, { label: 'Marina Lopes', personId: 'person-marina' });
    assert.equal(resolveSourceRef([source], segmentRef(source.id, 1, 'seg-999')), undefined);
    assert.equal(resolveSourceRef([source], segmentRef(source.id, 2, 'seg-001')), undefined);
    assert.equal(resolveSourceRef([source], segmentRef(source.id, 1, 'seg-001', { from: 5, to: 500 })), undefined);
    assert.equal(resolveSourceRef([source], segmentRef('other', 1, 'seg-001')), undefined);
  });
});

describe('source revisions (R4 corrections)', () => {
  test('keep segment ids stable, add a version and keep old refs resolvable', () => {
    const kit = createKit();
    const source = sampleSource(kit);
    kit.advance();
    const revised = reviseSource(source, [{ type: 'update', segmentId: 'seg-004', text: 'A feira de 2016 mudou tudo.' }], kit.ctx(), 'Ano corrigido');
    assert.ok(revised.ok);
    const next = revised.value;
    assert.equal(next.versions.length, 2);
    assert.equal(currentSourceVersion(next).note, 'Ano corrigido');
    assert.deepEqual(
      currentSourceVersion(next).content.segments.map((segment) => segment.id),
      currentSourceVersion(source).content.segments.map((segment) => segment.id),
    );
    assert.equal(resolveSourceRef([next], segmentRef(source.id, 1, 'seg-004'))?.excerpt, 'A feira mudou tudo. A gente saiu de lá com vinte lojistas novos e a certeza de que o couro reaproveitado tinha mercado.');
    assert.equal(resolveSourceRef([next], segmentRef(source.id, 2, 'seg-004'))?.excerpt, 'A feira de 2016 mudou tudo.');
  });

  test('new segments never reuse an id, even one removed earlier', () => {
    const kit = createKit();
    const source = sampleSource(kit);
    const removed = reviseSource(source, [{ type: 'remove', segmentId: 'seg-006' }], kit.ctx());
    assert.ok(removed.ok);
    const inserted = reviseSource(removed.value, [{ type: 'insert', afterSegmentId: 'seg-001', text: 'Nova fala.', speaker: 'Marina Lopes' }], kit.ctx());
    assert.ok(inserted.ok);
    const ids = currentSourceVersion(inserted.value).content.segments.map((segment) => segment.id);
    assert.deepEqual(ids, ['seg-001', 'seg-007', 'seg-002', 'seg-003', 'seg-004', 'seg-005']);
  });

  test('speaker corrections update the speaker list; no-op and empty edits are refused', () => {
    const kit = createKit();
    const source = sampleSource(kit);
    const renamed = reviseSource(source, [{ type: 'update', segmentId: 'seg-001', speaker: 'Joana Reis' }], kit.ctx());
    assert.ok(renamed.ok);
    assert.ok(renamed.value.speakers.some((speaker) => speaker.label === 'Joana Reis'));
    const noop = reviseSource(source, [{ type: 'update', segmentId: 'seg-001', text: 'Como começou o Ateliê Sul?' }], kit.ctx());
    assert.equal(!noop.ok && noop.refusal.code, 'no_changes');
    const empty = reviseSource(source, [{ type: 'update', segmentId: 'seg-001', text: '   ' }], kit.ctx());
    assert.equal(!empty.ok && empty.refusal.code, 'empty_text');
    const unknown = reviseSource(source, [{ type: 'remove', segmentId: 'seg-404' }], kit.ctx());
    assert.equal(!unknown.ok && unknown.refusal.code, 'unknown_segment');
  });

  test('speaker → person mapping is metadata, not a new version', () => {
    const source = sampleSource(createKit());
    const mapped = mapSpeaker(source, 'Entrevistadora', 'person-joana');
    assert.equal(mapped.versions.length, 1);
    assert.deepEqual(mapped.speakers[0], { label: 'Entrevistadora', personId: 'person-joana' });
    assert.deepEqual(mapSpeaker(mapped, 'Entrevistadora', null).speakers[0], { label: 'Entrevistadora' });
  });

  test('creating from parsed material uses the context ids and time', () => {
    const kit = createKit();
    const source = createTranscriptSource(
      { workspaceId: WORKSPACE, title: '  Podcast  ', origin: 'podcast', parsed: parseTranscript('Texto corrido.'), authorized: false, recordedOn: '2026-10-01' },
      kit.ctx(),
    );
    assert.equal(source.id, 'src-1');
    assert.equal(source.title, 'Podcast');
    assert.equal(source.recordedOn, '2026-10-01');
    assert.deepEqual(source.speakers, []);
  });
});
