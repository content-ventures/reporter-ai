import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Editor } from '@tiptap/react';
import { undo } from '@tiptap/pm/history';
import { paragraphBlock, textReviewOf } from '../domain/index.ts';
import type { ArticleBody } from '../domain/index.ts';
import { setTextReview } from './commands.ts';
import { docBody } from './nodes.ts';
import { articleState, testView } from './test-support.ts';

const BODY: ArticleBody = {
  type: 'article',
  title: '',
  blocks: [
    paragraphBlock('p1', 'Primeiro parágrafo da IA.', { ai: 'unreviewed' }),
    paragraphBlock('p2', 'Segundo parágrafo da IA.', { ai: 'unreviewed' }),
    paragraphBlock('p3', 'Parágrafo de uma pessoa.'),
  ],
};

function open() {
  const view = testView(articleState(BODY, { history: true }));
  // The command reads `state` and dispatches on `view`: a double with the same two members.
  const editor = { get state() { return view.state; }, view } as unknown as Editor;
  const review = () => textReviewOf(docBody(view.state.doc, { keepEmpty: true }));
  return { view, editor, review };
}

describe('the review of the whole text in the editor', () => {
  test('marks every AI block in one step, leaves the human text alone, and one undo reopens it', () => {
    const { view, editor, review } = open();
    assert.equal(review(), 'pending');
    assert.equal(setTextReview(editor, 'reviewed'), true);
    assert.equal(view.dispatched.length, 1, 'one transaction for the whole text');
    assert.equal(review(), 'reviewed');
    assert.deepEqual(docBody(view.state.doc, { keepEmpty: true }).blocks.map((block) => block.ai), ['reviewed', 'reviewed', undefined]);
    assert.equal(setTextReview(editor, 'reviewed'), false, 'nothing left to mark');
    assert.ok(undo(view.state, view.dispatch));
    assert.equal(review(), 'pending');
  });

  test('"Desfazer" sends the reviewed AI blocks back to review, text untouched', () => {
    const { view, editor, review } = open();
    setTextReview(editor, 'reviewed');
    const before = docBody(view.state.doc, { keepEmpty: true }).blocks.map((block) => block.id);
    assert.equal(setTextReview(editor, 'unreviewed'), true);
    assert.equal(review(), 'pending');
    assert.deepEqual(docBody(view.state.doc, { keepEmpty: true }).blocks.map((block) => block.id), before);
    assert.equal(setTextReview(editor, 'unreviewed'), false);
  });
});
