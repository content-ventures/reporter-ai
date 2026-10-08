import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  articleHash,
  articleLinks,
  articlePlainText,
  articleStats,
  blockText,
  listBlock,
  markBlocksReviewed,
  normalizeInlines,
  paragraphBlock,
  replaceTextRange,
  sliceText,
  spliceInlines,
  unreviewedAiBlockIds,
} from './article.ts';
import type { ArticleBody } from './article.ts';
import { segmentRef } from './refs.ts';

const body = (): ArticleBody => ({
  type: 'article',
  title: ' Título ',
  blocks: [
    paragraphBlock('p1', [{ text: 'Começo ' }, { text: 'forte', marks: ['bold'] }, { text: ' e fim.' }], { ai: 'unreviewed' }),
    listBlock('l1', ['primeiro item', 'segundo item'], true),
    { id: 'd1', type: 'divider' },
  ],
});

describe('inlines', () => {
  test('normalisation merges equal runs, drops empty ones, sorts marks and pairs link with href', () => {
    assert.deepEqual(
      normalizeInlines([
        { text: 'a', marks: ['italic', 'bold'] },
        { text: 'b', marks: ['bold', 'italic', 'bold'] },
        { text: '' },
        { text: 'c', marks: ['link'] },
        { text: 'd', marks: ['link'], href: 'https://x.com' },
      ]),
      [
        { text: 'ab', marks: ['bold', 'italic'] },
        { text: 'c' },
        { text: 'd', marks: ['link'], href: 'https://x.com' },
      ],
    );
  });

  test('splicing keeps formatting around the edit and inherits it for the inserted text', () => {
    const inlines = [{ text: 'Começo ' }, { text: 'forte', marks: ['bold' as const] }, { text: ' e fim.' }];
    assert.deepEqual(spliceInlines(inlines, 7, 12, 'firme'), [{ text: 'Começo ' }, { text: 'firme', marks: ['bold'] }, { text: ' e fim.' }]);
    assert.deepEqual(spliceInlines(inlines, 0, 0, 'Um '), [{ text: 'Um Começo ' }, { text: 'forte', marks: ['bold'] }, { text: ' e fim.' }]);
  });

  test('a link is extended only when the replaced range sat inside it', () => {
    const inlines = [{ text: 'veja ' }, { text: 'o site', marks: ['link' as const], href: 'https://a.com' }];
    assert.deepEqual(spliceInlines(inlines, 7, 11, 'portal'), [
      { text: 'veja ' },
      { text: 'o portal', marks: ['link'], href: 'https://a.com' },
    ]);
    assert.deepEqual(spliceInlines(inlines, 0, 11, 'leia'), [{ text: 'leia' }]);
  });
});

describe('article body', () => {
  test('plain text, stats and list item separator', () => {
    const article = body();
    assert.equal(blockText(article.blocks[1]), 'primeiro item\nsegundo item');
    assert.equal(articlePlainText(article), 'Começo forte e fim.\n\nprimeiro item\nsegundo item');
    assert.equal(articleStats(article).words, 8);
  });

  test('hash covers publishable content only (ids, AI flags and refs excluded)', () => {
    const article = body();
    const reidentified: ArticleBody = {
      ...article,
      title: 'Título',
      blocks: article.blocks.map((block, index) => ({ ...block, id: `x${index}`, ai: 'reviewed' as const, sourceRefs: [segmentRef('s', 1, 'seg-001')] })),
    };
    assert.equal(articleHash(reidentified), articleHash(article));
    const changed = replaceTextRange(article, { blockId: 'p1', from: 0, to: 6 }, 'Início');
    assert.ok(changed.ok);
    assert.notEqual(articleHash(changed.value), articleHash(article));
    const bolder: ArticleBody = { ...article, blocks: [paragraphBlock('p1', [{ text: 'Começo forte e fim.', marks: ['bold'] }]), ...article.blocks.slice(1)] };
    assert.notEqual(articleHash(bolder), articleHash(article), 'marks are content');
  });

  test('text ranges address blocks and single list items', () => {
    const article = body();
    assert.equal(sliceText(article, { blockId: 'l1', from: 14, to: 26 }), 'segundo item');
    const replaced = replaceTextRange(article, { blockId: 'l1', from: 14, to: 21 }, 'último');
    assert.ok(replaced.ok);
    assert.equal(blockText(replaced.value.blocks[1]), 'primeiro item\núltimo item');
    const across = replaceTextRange(article, { blockId: 'l1', from: 5, to: 20 }, 'x');
    assert.equal(across.ok, false);
    assert.equal(!across.ok && across.refusal.code, 'spans_list_items');
    assert.equal(replaceTextRange(article, { blockId: 'nope', from: 0, to: 1 }, 'x').ok, false);
    assert.equal(replaceTextRange(article, { blockId: 'p1', from: 5, to: 99 }, 'x').ok, false);
    assert.equal(replaceTextRange(article, { blockId: 'd1', from: 0, to: 0 }, 'x').ok, false);
  });

  test('marking AI blocks reviewed and listing links', () => {
    const article = body();
    assert.deepEqual(unreviewedAiBlockIds(article), ['p1']);
    assert.deepEqual(unreviewedAiBlockIds(markBlocksReviewed(article, ['p1'])), []);
    const linked: ArticleBody = { ...article, blocks: [paragraphBlock('p2', [{ text: 'site', marks: ['link'], href: 'https://a.com' }])] };
    assert.deepEqual(articleLinks(linked), [{ blockId: 'p2', href: 'https://a.com', text: 'site' }]);
  });
});
