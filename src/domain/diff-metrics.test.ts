import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { dividerBlock, headingBlock, paragraphBlock } from './article.ts';
import type { ArticleBody } from './article.ts';
import { diffArticles, diffCarousels, diffSummary } from './diff.ts';
import { aiRetention, median, productionRetention, timeToApprovalMs } from './metrics.ts';
import { baseRecord, commitVersion, createKit, recordDecision, sampleArticle, sampleCarousel, TEMPLATE } from './testing/scenario.ts';

const v1: ArticleBody = {
  type: 'article',
  title: 'Da garagem à feira',
  blocks: [
    paragraphBlock('p1', 'O Ateliê Sul nasceu numa garagem em 2015.'),
    headingBlock('h1', 'O começo'),
    paragraphBlock('p2', 'Duas máquinas de costura e muita teimosia.'),
    paragraphBlock('p3', 'Este parágrafo será removido por completo.'),
    dividerBlock('d1'),
  ],
};

const v2: ArticleBody = {
  type: 'article',
  title: 'Da garagem à feira de calçados',
  blocks: [
    paragraphBlock('p1', 'O Ateliê Sul nasceu numa garagem de Novo Hamburgo em 2015.'),
    headingBlock('h1', 'O começo', 3),
    // Regenerated with a new id but mostly the same words → paired as "modified".
    paragraphBlock('x2', 'Duas máquinas de costura velhas e muita teimosia.'),
    paragraphBlock('n1', 'Um parágrafo totalmente novo sobre a escola de ofício.'),
    dividerBlock('d1'),
  ],
};

describe('diffArticles', () => {
  test('aligns by id, pairs regenerated blocks by similarity and labels each change', () => {
    const blocks = diffArticles(v1, v2);
    assert.deepEqual(
      blocks.map((block) => [block.id, block.change, block.blockType]),
      [
        ['title', 'modified', 'title'],
        ['p1', 'modified', 'paragraph'],
        ['h1', 'modified', 'heading'],
        ['x2', 'modified', 'paragraph'],
        ['p3', 'removed', 'paragraph'],
        ['n1', 'added', 'paragraph'],
        ['d1', 'unchanged', 'divider'],
      ],
    );
    assert.deepEqual(blocks[1].hunks, [
      { kind: 'equal', text: 'O Ateliê Sul nasceu numa garagem ' },
      { kind: 'insert', text: 'de Novo Hamburgo ' },
      { kind: 'equal', text: 'em 2015.' },
    ]);
    assert.equal(blocks[2].formatOnly, true, 'heading level change only');
    assert.equal(blocks[2].level, 3);
    assert.deepEqual(diffSummary(blocks), { added: 1, removed: 1, modified: 4, unchanged: 1 });
  });

  test('identical bodies are all unchanged; an empty "before" is all added', () => {
    assert.ok(diffArticles(v1, v1).every((block) => block.change === 'unchanged'));
    const fresh = diffArticles({ type: 'article', title: '', blocks: [] }, v1);
    assert.deepEqual([...new Set(fresh.map((block) => block.change))], ['added']);
  });
});

describe('diffCarousels', () => {
  test('compares slide texts by slide id', () => {
    const before = sampleCarousel();
    const after = sampleCarousel();
    after.slides = [{ ...after.slides[0], slots: { title: 'Da garagem ao mercado' } }, after.slides[1], after.slides[3]];
    const blocks = diffCarousels(before, after, TEMPLATE);
    assert.deepEqual(
      blocks.map((block) => [block.id, block.change]),
      [
        ['s-1', 'modified'],
        ['s-2', 'unchanged'],
        ['s-3', 'removed'],
        ['s-4', 'unchanged'],
      ],
    );
    assert.equal(blocks[1].hunks[0].text, 'O começo\nDuas máquinas e muita teimosia.');
  });
});

describe('metrics', () => {
  test('aiRetention measures AI words kept, in order, in the approved text', () => {
    const generated: ArticleBody = { type: 'article', title: '', blocks: [paragraphBlock('p', 'um dois três quatro cinco seis sete oito nove dez')] };
    const approved: ArticleBody = { type: 'article', title: '', blocks: [paragraphBlock('p', 'Um dois três QUATRO cinco e mais palavras novas aqui')] };
    const retention = aiRetention(generated, approved);
    assert.equal(retention.kept, 5);
    assert.equal(retention.generatedWords, 10);
    assert.equal(retention.ratio, 0.5);
    assert.equal(aiRetention(generated, generated).ratio, 1);
    assert.equal(aiRetention({ type: 'article', title: '', blocks: [] }, generated).ratio, null);
  });

  test('production retention and time to approval use the real records', () => {
    const kit = createKit();
    const record = baseRecord(kit);
    const generated = commitVersion(record, kit, 'article', sampleArticle(record.sources[0]), { origin: 'generation' });
    assert.equal(productionRetention(record), undefined, 'nothing approved yet');
    assert.equal(timeToApprovalMs(record), undefined);
    const edited = commitVersion(record, kit, 'article', { ...(generated.body as ArticleBody), title: 'Título da editora' });
    recordDecision(record, kit, edited, 'approved');
    const retention = productionRetention(record);
    assert.ok(retention && retention.ratio !== null && retention.ratio < 1 && retention.ratio > 0.8);
    assert.equal(timeToApprovalMs(record), 3 * 60_000);
  });

  test('median', () => {
    assert.equal(median([]), undefined);
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 3, 2]), 2.5);
  });
});
