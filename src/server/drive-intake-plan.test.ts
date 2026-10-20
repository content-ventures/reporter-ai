import assert from 'node:assert/strict';
import { test } from 'node:test';
import { driveIds, driveMedia, driveProductionInput, folderFormat, materialSpeakers, partRange, transcriptText } from './drive-intake-plan.ts';

const SECRET = 'segredo-do-ensaio-com-mais-de-32-caracteres';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('a Drive file always derives the same upload and production ids, distinct per file and per secret', () => {
  const first = driveIds(SECRET, '1AbC_def-ghIJklmn'), again = driveIds(SECRET, '1AbC_def-ghIJklmn');
  assert.deepEqual(first, again);
  assert.match(first.sourceId, UUID);
  assert.match(first.productionRequest, UUID);
  assert.notEqual(first.sourceId, first.productionRequest);
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(first.key, /^[a-zA-Z0-9_-]{8,128}$/);
  assert.notEqual(driveIds(SECRET, '1AbC_def-ghIJklmo').sourceId, first.sourceId);
  assert.notEqual(driveIds(SECRET + 'x', '1AbC_def-ghIJklmn').token, first.token);
});

test('only the audio and video the transcription accepts are taken', () => {
  assert.deepEqual(driveMedia('Painel abertura.MP3'), { extension: 'mp3', contentType: 'audio/mpeg' });
  assert.deepEqual(driveMedia('estande.m4a'), { extension: 'm4a', contentType: 'audio/mp4' });
  assert.equal(driveMedia('slides.pdf'), undefined);
  assert.equal(driveMedia('video.mov'), undefined);
  assert.equal(driveMedia('sem-extensao'), undefined);
});

test('a subfolder named after a format picks it, with or without accents; anything else is the article', () => {
  assert.equal(folderFormat('Painel'), 'panel');
  assert.equal(folderFormat('PAINÉIS'), 'panel');
  assert.equal(folderFormat('Premiação'), 'awards');
  assert.equal(folderFormat('estande'), 'stand');
  assert.equal(folderFormat('Cobertura de estande'), 'stand');
  assert.equal(folderFormat('Abertura'), 'opening');
  assert.equal(folderFormat('Nota curta'), 'note');
  assert.equal(folderFormat('Artigo'), undefined);
  assert.equal(folderFormat(undefined), undefined);
});

test('the parts cover the file exactly, the last one shorter', () => {
  const size = 40, partSize = 16;
  const parts = [1, 2, 3].map(number => partRange(number, partSize, size));
  assert.deepEqual(parts.map(part => [part.start, part.end, part.length]), [[0, 15, 16], [16, 31, 16], [32, 39, 8]]);
  assert.equal(parts.reduce((total, part) => total + part.length, 0), size);
});

test('a ready transcript reaches the form as SRT, the same text a browser upload gives', () => {
  const text = transcriptText({ segments: [{ start_ms: 1000, end_ms: 9500, text: 'Bom dia a todos.' }, { start_ms: 3_661_001, end_ms: 3_662_000, text: 'Obrigado.' }] });
  assert.equal(text, '1\n00:00:01,000 --> 00:00:09,500\nBom dia a todos.\n\n2\n01:01:01,001 --> 01:01:02,000\nObrigado.');
  assert.equal(transcriptText({ content: 'Texto corrido.' }), 'Texto corrido.');
});

test('the production waits for authorization, with the event origin, the folder format and the suggested speakers', () => {
  const text = transcriptText({ segments: [{ start_ms: 0, end_ms: 4000, text: 'Eu sou Ana Lima, diretora da Pesca Sul.' }] });
  const speakers = materialSpeakers(text, [{ name: 'Ana Lima', title: 'diretora', organization: 'Pesca Sul', segmentId: 's1', excerpt: 'Eu sou Ana Lima' },
    { name: 'Bruno Reis', title: '', organization: '', segmentId: 's1', excerpt: 'Bruno Reis' }]);
  const input = driveProductionInput({ fileName: 'Painel_sustentabilidade.mp3', size: 1234, text, transcriptId: '00000000-0000-4000-8000-000000000001',
    title: 'Pesca sustentável no Sul', recordedOn: '2026-10-20', format: 'panel', speakers, people: [{ id: 'person-bruno', name: 'Bruno Reis' }] });
  assert.equal(input.title, 'Pesca sustentável no Sul');
  assert.equal(input.material.authorized, false);
  assert.equal(input.material.origin, 'event');
  assert.equal(input.material.transcriptId, '00000000-0000-4000-8000-000000000001');
  assert.equal(input.material.recordedOn, '2026-10-20');
  assert.equal(input.material.fileName, 'Painel_sustentabilidade.mp3');
  assert.equal(input.brief.format, 'panel');
  assert.ok(input.brief.formatSize);
  assert.deepEqual(input.plan, ['article', 'carousel']);
  assert.deepEqual(input.speakers?.map(speaker => [speaker.label, speaker.personId ?? speaker.newPerson?.name]), [['Ana Lima', 'Ana Lima'], ['Bruno Reis', 'person-bruno']]);
  assert.equal(input.speakers?.[0].newPerson?.organization, 'Pesca Sul');
});

test('without a suggested title the production is named after the file', () => {
  const input = driveProductionInput({ fileName: 'Abertura_oficial  dia 1.m4a', size: 10, text: 'Texto.', transcriptId: '00000000-0000-4000-8000-000000000002', speakers: [], people: [] });
  assert.equal(input.title, 'Abertura oficial dia 1');
  assert.equal(input.brief.format, undefined);
  assert.equal(input.material.recordedOn, undefined);
});
