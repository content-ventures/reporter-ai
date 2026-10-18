import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ArticleBody } from '../../../domain/article.ts';
import { placeImage } from './article-image.ts';

const BODY: ArticleBody = {
  type: 'article',
  title: 'Exportação de tilápia cresce',
  blocks: [{ id: 'p1', type: 'paragraph', inlines: [{ text: 'Lead.' }] }] as ArticleBody['blocks'],
  coverSlot: { subject: 'Tilápias no cesto' },
};

test('as cover the photo replaces the cover suggestion and keeps the text', () => {
  const next = placeImage(BODY, { assetId: 'a1', caption: 'Tilápias', alt: 'Tilápias em cesto' }, 'cover', 'f1');
  assert.deepEqual(next.cover, { assetId: 'a1', caption: 'Tilápias', alt: 'Tilápias em cesto' });
  assert.equal(next.coverSlot, undefined);
  assert.equal(next.blocks.length, 1);
});

test('in the text the photo becomes a figure at the end', () => {
  const next = placeImage(BODY, { assetId: 'a2', caption: 'Porto' }, 'body', 'f2');
  assert.equal(next.blocks.length, 2);
  assert.deepEqual(next.blocks[1], { id: 'f2', type: 'figure', image: { assetId: 'a2', caption: 'Porto' } });
  assert.deepEqual(next.coverSlot, BODY.coverSlot);
});
