import assert from 'node:assert/strict';
import { test } from 'node:test';
import { photoOf } from './news-photo.ts';

test('a story photo is kept as the publication sent it', () => {
  assert.equal(photoOf({ imageUrl: 'https://images.thefishsite.com/media/salmon.webp' }), 'https://images.thefishsite.com/media/salmon.webp');
  assert.equal(photoOf({ imageUrl: ' https://cdn.example/foto.jpg?w=800 ' }), 'https://cdn.example/foto.jpg?w=800');
});

test('site icons and emoji never stand in for a photo', () => {
  assert.equal(photoOf({}), undefined);
  assert.equal(photoOf({ imageUrl: '' }), undefined);
  assert.equal(photoOf({ imageUrl: 'https://s.w.org/images/core/emoji/17.0.2/72x72/1f539.png' }), undefined);
  assert.equal(photoOf({ imageUrl: 'https://portal.example/favicon-32x32.png' }), undefined);
  assert.equal(photoOf({ imageUrl: 'https://portal.example/icon.ico' }), undefined);
  assert.equal(photoOf({ imageUrl: 'https://portal.example/icon.ico?v=2' }), undefined);
});
