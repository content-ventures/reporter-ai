import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LibraryImage, StockImage } from '../../../domain/visual-library.ts';
import { imageUsable } from '../../../domain/hard-news.ts';
import { archiveImageOf, bankPhotoOf, keptFrom } from './library-model.ts';

function stock(provider: StockImage['provider'], patch: Partial<StockImage> = {}): StockImage {
  return {
    provider, providerId: 'abc', title: 'Tilápias em cesto', creator: 'Ana Prado', sourceUrl: 'https://bank.exemplo/abc',
    imageUrl: 'https://img.exemplo/abc?w=2000', previewUrl: 'https://img.exemplo/abc?w=800', width: 3000, height: 2000,
    license: 'Licença do banco', licenseUrl: 'https://bank.exemplo/license', attribution: 'Foto de Ana Prado no banco', ...patch,
  };
}

function kept(provider: StockImage['provider'], patch: Partial<LibraryImage> = {}): LibraryImage {
  return { ...stock(provider), id: 'lib-1', fileKey: 'k', bytes: 1, createdAt: '2026-10-10T12:00:00.000Z', authorized: true, ...patch };
}

test('a bank result of Unsplash or Pexels becomes a bank photo; other banks are left out', () => {
  const photo = bankPhotoOf(stock('pexels', { creatorUrl: 'https://pexels.exemplo/ana' }));
  assert.equal(photo?.provider, 'pexels');
  assert.equal(photo?.creatorUrl, 'https://pexels.exemplo/ana');
  assert.deepEqual(photo?.tags, []);
  assert.equal(bankPhotoOf(stock('openverse')), undefined);
  assert.equal(bankPhotoOf(stock('pixabay')), undefined);
});

test('a kept bank photo is a cleared archive photo, credited as the portal publishes it', () => {
  const image = archiveImageOf(kept('pexels'));
  assert.equal(image.id, 'lib-1');
  assert.equal(image.credit, 'Ana Prado/Pexels');
  assert.equal(image.license, 'stock');
  assert.equal(image.origin?.providerId, 'abc');
  assert.equal(image.takenOn, '2026-10-10');
  assert.equal(image.src, '/api/reporter/visuals/images/lib-1/file');
  assert.ok(imageUsable(image));
});

test('an Unsplash photo is hotlinked, and a photo of another bank keeps its attribution', () => {
  assert.equal(archiveImageOf(kept('unsplash')).src, 'https://img.exemplo/abc?w=2000');
  const other = archiveImageOf(kept('openverse'));
  assert.equal(other.credit, 'Foto de Ana Prado no banco');
  assert.equal(other.origin, undefined);
  assert.ok(imageUsable(other));
});

test('saving a bank photo twice finds the copy already kept', () => {
  const images = [kept('pexels'), kept('unsplash', { id: 'lib-2', providerId: 'xyz' })];
  assert.equal(keptFrom(images, 'unsplash', 'xyz')?.id, 'lib-2');
  assert.equal(keptFrom(images, 'unsplash', 'abc'), undefined);
});
