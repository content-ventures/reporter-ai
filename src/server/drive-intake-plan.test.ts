import assert from 'node:assert/strict';
import { test } from 'node:test';
import { driveIds, driveMedia, folderFormat, partRange } from './drive-intake-plan.ts';

const SECRET = 'segredo-do-ensaio-com-mais-de-32-caracteres';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('a Drive file always derives the same upload ids, distinct per file and per secret', () => {
  const first = driveIds(SECRET, '1AbC_def-ghIJklmn'), again = driveIds(SECRET, '1AbC_def-ghIJklmn');
  assert.deepEqual(first, again);
  assert.match(first.sourceId, UUID);
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
