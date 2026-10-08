import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { undo } from '@tiptap/pm/history';
import { TextSelection } from '@tiptap/pm/state';
import { applySuggestion, locateTargets, paragraphBlock, quoteBlock, sliceText } from '../domain/index.ts';
import type { ArticleBody, Suggestion, SuggestionProposal, TextRange } from '../domain/index.ts';
import { articleDecorationInput, articleDecorationsKey, setArticleDecorations } from './decorations.ts';
import { docBody } from './nodes.ts';
import { findBlockEntry, offsetToPos, posToBlockOffset } from './ranges.ts';
import {
  applySuggestionInEditor,
  isSuggestionStaleInDoc,
  locateSuggestionInDoc,
  suggestionAtCaret,
  suggestionDecorations,
  suggestionTransaction,
  SUGGESTION_META,
} from './suggestions.ts';
import { articleState, REF_A, testView } from './test-support.ts';

const BODY: ArticleBody = {
  type: 'article',
  title: '',
  blocks: [
    paragraphBlock('p1', 'O ateliê começou numa garagem em 2015 e hoje emprega doze pessoas.', { ai: 'unreviewed', sourceRefs: [REF_A] }),
    paragraphBlock('p2', [{ text: 'Segundo ' }, { text: 'parágrafo', marks: ['bold'] }, { text: ' aqui.' }], { ai: 'unreviewed' }),
    quoteBlock('q1', 'Uma citação curta'),
    paragraphBlock('p3', 'Fim do texto.'),
  ],
};

function suggestion(target: TextRange[], proposal: SuggestionProposal, overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    id: 'sug-1',
    runId: 'run-a',
    pieceId: 'piece-1',
    baseRevision: 1,
    target,
    anchorText: target.map((range) => sliceText(BODY, range) ?? ''),
    proposal,
    state: 'ready',
    createdAt: '2026-10-07T12:00:00.000Z',
    ...overrides,
  };
}

const REWRITE = suggestion([{ blockId: 'p1', from: 2, to: 8 }], { kind: 'replace-text', text: 'estúdio' });

describe('accepting a suggestion', () => {
  test('replace-text: the document ends equal to the domain applySuggestion, and the block is reviewed', () => {
    const view = testView(articleState(BODY));
    const expected = applySuggestion(docBody(view.state.doc, { keepEmpty: true }), REWRITE);
    assert.ok(expected.ok);
    const result = applySuggestionInEditor(view, REWRITE);
    assert.ok(result.ok);
    assert.deepEqual(result.value, expected.value);
    assert.deepEqual(docBody(view.state.doc, { keepEmpty: true }), expected.value);
    assert.equal(view.state.doc.child(0).attrs.ai, 'reviewed');
    assert.equal(view.dispatched[0].getMeta(SUGGESTION_META), 'sug-1');
  });

  test('accepting removes that suggestion\'s delete marks and keeps the others', () => {
    const view = testView(articleState(BODY));
    const other = suggestion([{ blockId: 'p3', from: 0, to: 3 }], { kind: 'replace-text', text: 'Final' }, { id: 'sug-2' });
    setArticleDecorations(view, { suggestions: suggestionDecorations(view.state.doc, [REWRITE, other]) });
    assert.ok(applySuggestionInEditor(view, REWRITE).ok);
    assert.deepEqual(articleDecorationInput(view.state).suggestions.map((entry) => entry.id), ['sug-2']);
    const marked = articleDecorationsKey.getState(view.state)?.layers.suggestions.find() ?? [];
    assert.deepEqual(marked.map((decoration) => decoration.spec.suggestionId), ['sug-2']);
  });

  test('only the changed characters are replaced, so a caret later in the block stays on its word', () => {
    const view = testView(articleState(BODY));
    const p1 = findBlockEntry(view.state.doc, 'p1');
    assert.ok(p1);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, offsetToPos(p1, 60))));
    assert.ok(applySuggestionInEditor(view, REWRITE).ok);
    assert.deepEqual(posToBlockOffset(view.state.doc, view.state.selection.from), { blockId: 'p1', index: 0, offset: 61 });
  });

  test('one ⌘Z reverts exactly the suggestion, even when the person types right after it', () => {
    const view = testView(articleState(BODY, { history: true }));
    const before = docBody(view.state.doc, { keepEmpty: true });
    assert.ok(applySuggestionInEditor(view, REWRITE).ok);
    const p3 = findBlockEntry(view.state.doc, 'p3');
    assert.ok(p3);
    view.dispatch(view.state.tr.insertText('!', p3.pos + p3.node.nodeSize - 1));
    assert.ok(undo(view.state, view.dispatch));
    const afterFirstUndo = docBody(view.state.doc);
    assert.equal(sliceText(afterFirstUndo, { blockId: 'p3', from: 0, to: 13 }), 'Fim do texto.');
    assert.equal(sliceText(afterFirstUndo, { blockId: 'p1', from: 2, to: 9 }), 'estúdio');
    assert.ok(undo(view.state, view.dispatch));
    assert.deepEqual(docBody(view.state.doc, { keepEmpty: true }), before);
    assert.equal(undo(view.state), false);
  });

  test('replace-blocks swaps neighbouring blocks in one step', () => {
    const view = testView(articleState(BODY, { history: true }));
    const replace = suggestion(
      [
        { blockId: 'p2', from: 0, to: 23 },
        { blockId: 'q1', from: 0, to: 17 },
      ],
      { kind: 'replace-blocks', blocks: [paragraphBlock('n1', 'Um parágrafo novo.', { ai: 'unreviewed' })] },
    );
    const expected = applySuggestion(docBody(view.state.doc, { keepEmpty: true }), replace);
    assert.ok(expected.ok);
    assert.ok(applySuggestionInEditor(view, replace).ok);
    assert.deepEqual(docBody(view.state.doc, { keepEmpty: true }), expected.value);
    assert.deepEqual(
      expected.value.blocks.map((block) => [block.id, block.ai]),
      [
        ['p1', 'unreviewed'],
        ['n1', 'reviewed'],
        ['p3', undefined],
      ],
    );
    assert.ok(undo(view.state, view.dispatch));
    assert.deepEqual(docBody(view.state.doc, { keepEmpty: true }), BODY);
  });

  test('add-link links the target with the normalised address', () => {
    const view = testView(articleState(BODY));
    const link = suggestion([{ blockId: 'p3', from: 0, to: 3 }], { kind: 'add-link', href: 'https://example.com/fonte' });
    assert.ok(applySuggestionInEditor(view, link).ok);
    const p3 = docBody(view.state.doc).blocks.find((block) => block.id === 'p3');
    assert.deepEqual(p3, { id: 'p3', type: 'paragraph', inlines: [{ text: 'Fim', marks: ['link'], href: 'https://example.com/fonte' }, { text: ' do texto.' }] });
  });

  test('a title suggestion is not applied to the text', () => {
    const view = testView(articleState(BODY));
    const title = suggestion([], { kind: 'title', text: 'Outro título' });
    const result = suggestionTransaction(view.state, title);
    assert.equal(result.ok, false);
    assert.equal(result.ok ? '' : result.refusal.code, 'unsupported');
    assert.equal(isSuggestionStaleInDoc(view.state.doc, title), false);
  });
});

describe('staleness', () => {
  test('editing the target makes the suggestion stale and refuses to apply it', () => {
    const view = testView(articleState(BODY));
    const p1 = findBlockEntry(view.state.doc, 'p1');
    assert.ok(p1);
    view.dispatch(view.state.tr.insertText('X', offsetToPos(p1, 4)));
    assert.equal(locateSuggestionInDoc(view.state.doc, REWRITE), undefined);
    assert.equal(isSuggestionStaleInDoc(view.state.doc, REWRITE), true);
    const result = suggestionTransaction(view.state, REWRITE);
    assert.equal(result.ok ? '' : result.refusal.code, 'stale');
  });

  test('text typed before the target moves it instead (same answer as the domain)', () => {
    const view = testView(articleState(BODY));
    view.dispatch(view.state.tr.insertText('Hoje, ', 1));
    const located = locateSuggestionInDoc(view.state.doc, REWRITE);
    assert.deepEqual(located, [{ blockId: 'p1', from: 8, to: 14 }]);
    assert.deepEqual(located, locateTargets(docBody(view.state.doc), REWRITE));
    const applied = applySuggestionInEditor(view, REWRITE);
    assert.ok(applied.ok);
    assert.equal(sliceText(applied.value, { blockId: 'p1', from: 0, to: 15 }), 'Hoje, O estúdio');
  });

  test('a deleted target block is stale', () => {
    const view = testView(articleState(BODY));
    const p1 = findBlockEntry(view.state.doc, 'p1');
    assert.ok(p1);
    view.dispatch(view.state.tr.delete(p1.pos, p1.pos + p1.node.nodeSize));
    assert.equal(isSuggestionStaleInDoc(view.state.doc, REWRITE), true);
  });

  test('decoration input: located targets for pending suggestions, original targets flagged stale', () => {
    const view = testView(articleState(BODY));
    const stale = suggestion([{ blockId: 'p3', from: 0, to: 3 }], { kind: 'replace-text', text: 'Final' }, { id: 'sug-2', anchorText: ['Começo'] });
    const discarded = { ...REWRITE, id: 'sug-3', state: 'discarded' as const };
    const title = suggestion([], { kind: 'title', text: 'T' }, { id: 'sug-4' });
    assert.deepEqual(suggestionDecorations(view.state.doc, [REWRITE, stale, discarded, title]), [
      { id: 'sug-1', ranges: [{ blockId: 'p1', from: 2, to: 8 }] },
      { id: 'sug-2', ranges: [{ blockId: 'p3', from: 0, to: 3 }], stale: true },
    ]);
  });
});

describe('suggestionAtCaret', () => {
  const rewrite = suggestion([{ blockId: 'p1', from: 2, to: 8 }], { kind: 'replace-text', text: 'estúdio' });
  const at = (blockId: string, offset: number, to?: number) => {
    const state = articleState(BODY);
    const entry = findBlockEntry(state.doc, blockId);
    assert.ok(entry);
    const from = offsetToPos(entry, offset);
    return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to === undefined ? from : offsetToPos(entry, to))));
  };

  test('the caret inside the passage, or at its edges, is in the suggestion', () => {
    assert.equal(suggestionAtCaret(at('p1', 4), [rewrite]), 'sug-1');
    assert.equal(suggestionAtCaret(at('p1', 2), [rewrite]), 'sug-1');
    assert.equal(suggestionAtCaret(at('p1', 8), [rewrite]), 'sug-1');
    assert.equal(suggestionAtCaret(at('p1', 20), [rewrite]), null);
    assert.equal(suggestionAtCaret(at('p2', 3), [rewrite]), null);
  });

  test('selected text belongs to the selection bar; titles never sit in the text', () => {
    assert.equal(suggestionAtCaret(at('p1', 2, 6), [rewrite]), null);
    const title = { ...rewrite, id: 'sug-t', proposal: { kind: 'title' as const, text: 'Outro' } };
    assert.equal(suggestionAtCaret(at('p1', 4), [title]), null);
  });

  test('a stale suggestion counts where its passage was', () => {
    const stale = { ...rewrite, anchorText: ['não está'], state: 'stale' as const };
    assert.equal(suggestionAtCaret(at('p1', 5), [stale]), 'sug-1');
  });
});
