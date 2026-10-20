import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { segmentRef } from './refs.ts';
import {
  createTranscriptSource,
  currentSourceVersion,
  findDuplicateSource,
  mapSpeaker,
  materialPartHashes,
  placeLabel,
  resolveSourceRef,
  reviseSource,
  segmentPlace,
  sourceContentHash,
  toSourceVersionRef,
} from './source.ts';
import { createKit, JOAO, SAMPLE_TRANSCRIPT, sampleSource, WORKSPACE } from './testing/scenario.ts';
import { joinTranscriptParts, parseTranscript } from './text/transcript-parse.ts';

describe('transcript source', () => {
  test('presented participants persist with literal evidence without attributing unlabeled utterances', () => {
    const parsed = parseTranscript('Eu sou Marina Costa. Vamos conversar sobre bibliotecas.');
    const evidence = { segmentId: parsed.segments[0].id, excerpt: 'Eu sou Marina Costa.' };
    const source = createTranscriptSource({ workspaceId: WORKSPACE, title: 'Bibliotecas', origin: 'podcast', authorized: true,
      parsed, presentations: { 'Marina Costa': evidence, 'Nome inventado': evidence }, speakerPeople: { 'Marina Costa': 'person-marina' } }, createKit().ctx());
    assert.deepEqual(source.speakers, [{ label: 'Marina Costa', personId: 'person-marina', presentation: evidence }]);
    assert.ok(currentSourceVersion(source).content.segments.every(segment => !segment.speaker));
  });
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

describe('a material sent in parts', () => {
  const PART_ONE = ['1', '00:00:00,000 --> 00:00:04,000', 'Ana: Começamos numa garagem.', '', '2', '00:00:05,000 --> 00:00:09,000', 'Bia: E depois?', ''].join('\n');
  const PART_TWO = ['1', '00:00:00,000 --> 00:00:02,000', 'Ana: A feira mudou tudo.', '', '2', '00:00:03,000 --> 00:00:07,000', 'Bia: Que bom.', ''].join('\n');
  const FILES = [{ text: PART_ONE, fileName: 'parte-1.srt' }, { text: PART_TWO, fileName: 'parte-2.srt' }];
  const singleHash = (text: string, fileName?: string) =>
    currentSourceVersion(createTranscriptSource({ workspaceId: WORKSPACE, title: 'Arquivo', origin: 'interview', authorized: true, parsed: parseTranscript(text, { fileName }) }, createKit().ctx())).hash;

  function partsSource() {
    const text = joinTranscriptParts(FILES);
    const [first, second] = materialPartHashes(text) ?? [];
    return createTranscriptSource(
      { workspaceId: WORKSPACE, title: 'Entrevista em partes', origin: 'interview', authorized: true, parsed: parseTranscript(text),
        parts: [{ fileName: 'parte-1.srt', transcriptId: 'tr-1', hash: first }, { fileName: 'parte-2.srt', hash: second }] },
      createKit().ctx(),
    );
  }

  test('createTranscriptSource keeps the recordings of a material in parts', () => {
    const source = partsSource();
    assert.deepEqual(source.parts, [
      { fileName: 'parte-1.srt', transcriptId: 'tr-1', hash: singleHash(PART_ONE, 'parte-1.srt'), startMs: 0, durationMs: 9_000 },
      { fileName: 'parte-2.srt', hash: singleHash(PART_TWO, 'parte-2.srt'), startMs: 9_000, durationMs: 7_000 },
    ]);
    assert.deepEqual(currentSourceVersion(source).content.segments.map((segment) => [segment.part, segment.startMs]), [[1, 0], [1, 5_000], [2, 9_000], [2, 12_000]]);
    const alone = createTranscriptSource({ workspaceId: WORKSPACE, title: 'Arquivo', origin: 'interview', authorized: true, parsed: parseTranscript(PART_ONE),
      parts: [{ fileName: 'parte-1.srt', hash: 'h1' }, { fileName: 'parte-2.srt', hash: 'h2' }] }, createKit().ctx());
    assert.equal(alone.parts, undefined);
  });

  test('the part field never changes a content hash', () => {
    const segments = currentSourceVersion(partsSource()).content.segments;
    const untagged = segments.map((segment) => {
      const copy = { ...segment };
      delete copy.part;
      return copy;
    });
    assert.ok(segments.every((segment) => segment.part !== undefined));
    assert.equal(sourceContentHash({ type: 'transcript', format: 'srt', segments }), sourceContentHash({ type: 'transcript', format: 'srt', segments: untagged }));
  });

  test('materialPartHashes gives each recording the hash it has as a single file', () => {
    const files = [
      { text: '00:01.000 --> 00:03.000\nAna: Bom dia.\n\n00:03.500 --> 00:05.000\nBia: Bom dia, Ana.\n', fileName: 'a.vtt' },
      { text: '00:00:01,000 --> 00:00:02,000\nPrimeira fala.\n\n00:00:02,500 --> 00:00:04,000\nSegunda fala.\n', fileName: 'b.srt' },
      { text: 'Ana: Texto livre.\r\nBia: Outra linha.\r\n', fileName: 'c.txt' },
    ];
    assert.deepEqual(materialPartHashes(joinTranscriptParts(files)), files.map(({ text, fileName }) => singleHash(text, fileName)));
    assert.equal(materialPartHashes(PART_ONE), undefined);
  });

  test('an inserted segment belongs to the part of the segment before it', () => {
    const kit = createKit();
    const source = partsSource();
    const after = reviseSource(source, [{ type: 'insert', afterSegmentId: 'seg-003', text: 'Nova fala.' }], kit.ctx());
    assert.ok(after.ok);
    assert.equal(currentSourceVersion(after.value).content.segments[3].part, 2);
    const first = reviseSource(source, [{ type: 'insert', afterSegmentId: null, text: 'Abertura.' }], kit.ctx());
    assert.ok(first.ok);
    assert.equal(currentSourceVersion(first.value).content.segments[0].part, 1);
  });

  test('segmentPlace gives the part and the time inside its file', () => {
    const source = partsSource();
    const segments = currentSourceVersion(source).content.segments;
    const place = segmentPlace(source, segments[3]);
    assert.deepEqual(place, { part: 2, count: 2, fileName: 'parte-2.srt', startMs: 3_000 });
    assert.equal(segmentPlace(sampleSource(createKit()), segments[3]), undefined);
    assert.ok(place);
    assert.equal(placeLabel(place), 'Parte 2 · 00:03');
    assert.equal(placeLabel({ part: 2 }), 'Parte 2');
  });

  test('findDuplicateSource finds a recording used as a part', () => {
    const source = partsSource();
    assert.equal(findDuplicateSource([source], singleHash(PART_TWO, 'parte-2.srt'))?.id, source.id);
    assert.equal(findDuplicateSource([source], singleHash('Ana: Outra conversa.\nBia: Sim.')), undefined);
  });
});
