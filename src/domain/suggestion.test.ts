import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { blockText, headingBlock, paragraphBlock, replaceTextRange } from './article.ts';
import type { ArticleBody } from './article.ts';
import { applySlideSuggestion, applySuggestion, isSuggestionPending, isSuggestionStale, locateTargets } from './suggestion.ts';
import type { Suggestion, SuggestionProposal } from './suggestion.ts';
import { sampleCarousel } from './testing/scenario.ts';

const body = (): ArticleBody => ({
  type: 'article',
  title: 'Título',
  blocks: [
    paragraphBlock('p1', 'A feira mudou tudo para o ateliê.', { ai: 'unreviewed' }),
    paragraphBlock('p2', 'Hoje são vinte lojistas.', { ai: 'unreviewed' }),
    headingBlock('h1', 'Próximos passos'),
  ],
});

function suggestion(proposal: SuggestionProposal, target = [{ blockId: 'p1', from: 2, to: 7 }], anchorText = ['feira']): Suggestion {
  return { id: 'sug-1', runId: 'run-9', pieceId: 'piece-article', baseRevision: 3, target, anchorText, proposal, state: 'ready', createdAt: '2026-10-07T12:00:00.000Z' };
}

describe('suggestion targets', () => {
  test('stay valid when the target text is untouched, even if offsets shift', () => {
    const shifted = replaceTextRange(body(), { blockId: 'p1', from: 0, to: 0 }, 'Para Marina, ');
    assert.ok(shifted.ok);
    assert.deepEqual(locateTargets(shifted.value, suggestion({ kind: 'replace-text', text: 'exposição' })), [{ blockId: 'p1', from: 15, to: 20 }]);
    assert.equal(isSuggestionStale(shifted.value, suggestion({ kind: 'replace-text', text: 'exposição' })), false);
  });

  test('become stale when the person edits the target ("Trecho mudou · Reaplicar")', () => {
    const edited = replaceTextRange(body(), { blockId: 'p1', from: 2, to: 7 }, 'exposição');
    assert.ok(edited.ok);
    const pending = suggestion({ kind: 'replace-text', text: 'mostra' });
    assert.equal(isSuggestionStale(edited.value, pending), true);
    const applied = applySuggestion(edited.value, pending);
    assert.equal(!applied.ok && applied.refusal.code, 'stale');
  });

  test('ambiguous anchors (text occurs twice) are stale rather than guessed', () => {
    const doubled: ArticleBody = { ...body(), blocks: [paragraphBlock('p1', 'X feira e outra feira.')] };
    assert.equal(locateTargets(doubled, suggestion({ kind: 'replace-text', text: 'y' }, [{ blockId: 'p1', from: 30, to: 35 }])), undefined);
  });
});

describe('applying suggestions', () => {
  test('replace-text changes only the range and leaves the block as AI text to review', () => {
    const result = applySuggestion(body(), suggestion({ kind: 'replace-text', text: 'exposição' }));
    assert.ok(result.ok);
    assert.equal(blockText(result.value.blocks[0]), 'A exposição mudou tudo para o ateliê.');
    assert.equal(result.value.blocks[0].ai, 'unreviewed');
    assert.equal(result.value.blocks[1].ai, 'unreviewed');
  });

  test('replace-blocks swaps contiguous blocks; non-contiguous targets are refused', () => {
    const proposal: SuggestionProposal = { kind: 'replace-blocks', blocks: [paragraphBlock('n1', 'Texto novo e único.', { ai: 'unreviewed' })] };
    const targets = [
      { blockId: 'p1', from: 0, to: 33 },
      { blockId: 'p2', from: 0, to: 24 },
    ];
    const anchors = ['A feira mudou tudo para o ateliê.', 'Hoje são vinte lojistas.'];
    const result = applySuggestion(body(), suggestion(proposal, targets, anchors));
    assert.ok(result.ok);
    assert.deepEqual(result.value.blocks.map((block) => [block.id, block.ai]), [
      ['n1', 'unreviewed'],
      ['h1', undefined],
    ]);
    const gap = applySuggestion(body(), suggestion(proposal, [targets[0], { blockId: 'h1', from: 0, to: 15 }], [anchors[0], 'Próximos passos']));
    assert.equal(!gap.ok && gap.refusal.code, 'invalid_target');
  });

  test('title and add-link proposals', () => {
    const titled = applySuggestion(body(), suggestion({ kind: 'title', text: '  Da garagem à feira ' }, [], []));
    assert.ok(titled.ok);
    assert.equal(titled.value.title, 'Da garagem à feira');
    const linked = applySuggestion(body(), suggestion({ kind: 'add-link', href: 'https://feira.com.br' }));
    assert.ok(linked.ok);
    const first = linked.value.blocks[0];
    assert.ok(first.type === 'paragraph');
    assert.deepEqual(first.inlines, [
      { text: 'A ' },
      { text: 'feira', marks: ['link'], href: 'https://feira.com.br' },
      { text: ' mudou tudo para o ateliê.' },
    ]);
  });

  test('only ready suggestions apply', () => {
    const streaming = { ...suggestion({ kind: 'replace-text', text: 'x' }), state: 'streaming' as const };
    assert.equal(isSuggestionPending(streaming), true);
    const result = applySuggestion(body(), streaming);
    assert.equal(!result.ok && result.refusal.code, 'not_pending');
    assert.equal(isSuggestionPending({ state: 'applied' }), false);
  });

  test('slide suggestions update slots of one slide', () => {
    const carousel = sampleCarousel();
    const result = applySlideSuggestion(carousel, suggestion({ kind: 'slide', slideId: 's-1', slots: { title: 'Da garagem ao mercado' } }, [], []));
    assert.ok(result.ok);
    assert.equal(result.value.slides[0].slots.title, 'Da garagem ao mercado');
    assert.equal(result.value.slides[0].ai, 'reviewed');
    const missing = applySlideSuggestion(carousel, suggestion({ kind: 'slide', slideId: 's-404', slots: {} }, [], []));
    assert.equal(!missing.ok && missing.refusal.code, 'stale');
  });
});
