import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blockText } from '../../../domain/article.ts';
import type { ArticleBody } from '../../../domain/article.ts';
import { advanceProviderPreview, emptyProviderPreview, providerPreviewHasMore } from './provider-preview-model.ts';

const body: ArticleBody = { type: 'article', title: 'Pauta', blocks: [
  { id: 'intro', type: 'paragraph', inlines: [{ text: '🚀 Texto chegando aos poucos.' }] },
  { id: 'section', type: 'heading', level: 2, inlines: [{ text: 'Próxima seção' }] },
  { id: 'paragraph', type: 'paragraph', inlines: [{ text: 'Segundo parágrafo.' }] },
] };

test('reveals received article text in order and stops at the final character', () => {
  let visible = emptyProviderPreview(body);
  visible = advanceProviderPreview(visible,body,1);
  assert.equal(blockText(visible.blocks[0]),'🚀');
  assert.equal(blockText(visible.blocks[1]),'');
  assert.equal(providerPreviewHasMore(visible,body),true);

  let ticks = 0;
  while (providerPreviewHasMore(visible,body) && ticks++ < 100) visible = advanceProviderPreview(visible,body,2);
  assert.ok(ticks < 100);
  assert.deepEqual(visible.blocks.map(blockText),body.blocks.map(blockText));
  assert.equal(providerPreviewHasMore(visible,body),false);
});

test('does not rewind visible prose when a refinement returns a different first pass', () => {
  const firstParagraph = body.blocks.find((block) => block.id === 'intro');
  if (!firstParagraph || firstParagraph.type !== 'paragraph') throw new Error('missing paragraph fixture');
  const first = { ...body, blocks: [firstParagraph] };
  let visible = emptyProviderPreview(first);
  while (providerPreviewHasMore(visible,first)) visible = advanceProviderPreview(visible,first,8);
  const revised: ArticleBody = { ...first, blocks: [{ ...firstParagraph, inlines: [{ text: 'Uma nova versão revista.' }] }] };
  const next = advanceProviderPreview(visible,revised,8);
  assert.equal(blockText(next.blocks[0]),'🚀 Texto chegando aos poucos.');
  assert.equal(providerPreviewHasMore(next,revised),false);
});
