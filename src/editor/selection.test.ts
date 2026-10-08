import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { blockKindAt } from './commands.ts';
import { findBlockEntry, offsetToPos } from './ranges.ts';
import { blockIdAtPoint, blockRect, caretAfterSelection, rangeRect, sectionLabel, selectionInfo, selectionRect, textRangeRect, unionCoords } from './selection.ts';
import type { Coords, RectInit } from './selection.ts';
import { articleState, FIGURE_BODY, RICH_BODY } from './test-support.ts';

const base = articleState(RICH_BODY);

function select(state: EditorState, from: number, to: number): EditorState {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
}

function pos(blockId: string, offset: number): number {
  const entry = findBlockEntry(base.doc, blockId);
  assert.ok(entry);
  return offsetToPos(entry, offset);
}

describe('selectionInfo', () => {
  test('a selection across blocks: ranges, ids, § numbers, label and text', () => {
    const state = select(base, pos('b2', 5), pos('b3', 8));
    const info = selectionInfo(state);
    assert.equal(info.empty, false);
    assert.deepEqual(info.ranges, [
      { blockId: 'b2', from: 5, to: 17 },
      { blockId: 'b3', from: 0, to: 8 },
    ]);
    assert.deepEqual(info.blockIds, ['b2', 'b3']);
    assert.deepEqual(info.blockNumbers, [2, 3]);
    assert.equal(info.label, '§2–3');
    assert.equal(info.text, 'tudo começou\n\nPrimeiro');
  });

  test('a caret has its block but no label or text', () => {
    const info = selectionInfo(select(base, pos('b8', 2), pos('b8', 2)));
    assert.deepEqual([info.empty, info.blockIds, info.label, info.text], [true, ['b8'], null, '']);
  });

  test('hard breaks read as line breaks', () => {
    const info = selectionInfo(select(base, pos('b1', 23), pos('b1', 33)));
    assert.equal(info.text, 'link\nlinha');
    assert.equal(info.label, '§1');
  });
});

describe('sectionLabel', () => {
  test('one block, a run, or a list of blocks', () => {
    assert.equal(sectionLabel([]), null);
    assert.equal(sectionLabel([3]), '§3');
    assert.equal(sectionLabel([5, 3, 4]), '§3–5');
    assert.equal(sectionLabel([2, 5]), '§2, §5');
  });
});

describe('blockKindAt', () => {
  test('names the style of the block under the selection', () => {
    assert.equal(blockKindAt(select(base, pos('b1', 1), pos('b1', 1))), 'paragraph');
    assert.equal(blockKindAt(select(base, pos('b2', 1), pos('b2', 1))), 'heading2');
    assert.equal(blockKindAt(select(base, pos('b3', 1), pos('b3', 1))), 'heading3');
    assert.equal(blockKindAt(select(base, pos('b4', 1), pos('b4', 1))), 'quote');
    assert.equal(blockKindAt(select(base, pos('b5', 1), pos('b5', 1))), 'orderedList');
    assert.equal(blockKindAt(select(base, pos('b6', 1), pos('b6', 1))), 'bulletList');
    const divider = findBlockEntry(base.doc, 'b7');
    assert.ok(divider);
    assert.equal(blockKindAt(base.apply(base.tr.setSelection(NodeSelection.create(base.doc, divider.pos)))), 'divider');
  });
});

describe('rectangles', () => {
  const coords = (pos: number): Coords => ({ left: pos * 10, right: pos * 10 + 2, top: pos < 20 ? 100 : 124, bottom: pos < 20 ? 120 : 144 });
  const makeRect = (init: RectInit) => init as unknown as DOMRect;

  test('unionCoords covers both caret boxes', () => {
    assert.deepEqual(unionCoords({ left: 50, right: 52, top: 10, bottom: 30 }, { left: 20, right: 22, top: 34, bottom: 54 }), { x: 20, y: 10, width: 32, height: 44 });
  });

  test('selection, range, block and text-range anchors come from coordsAtPos', () => {
    const state = select(base, 3, 25);
    const view = { state, coordsAtPos: coords };
    assert.deepEqual(selectionRect(view, makeRect), { x: 30, y: 100, width: 222, height: 44 });
    assert.deepEqual(rangeRect(view, 2, 4, makeRect), { x: 20, y: 100, width: 22, height: 20 });
    const b8 = findBlockEntry(state.doc, 'b8');
    assert.ok(b8);
    assert.deepEqual(blockRect(view, 'b8', makeRect), unionCoords(coords(b8.pos + 1), coords(b8.pos + b8.node.nodeSize - 1)));
    assert.deepEqual(textRangeRect(view, { blockId: 'b8', from: 0, to: 3 }, makeRect), unionCoords(coords(b8.pos + 1), coords(b8.pos + 4)));
    assert.equal(textRangeRect(view, { blockId: 'b8', from: 0, to: 99 }, makeRect), null);
  });

  test('no anchor for an empty selection, a destroyed view or a failing measure', () => {
    const caret = select(base, 3, 3);
    assert.equal(selectionRect({ state: caret, coordsAtPos: coords }, makeRect), null);
    assert.equal(rangeRect({ state: caret, coordsAtPos: coords, isDestroyed: true }, 1, 2, makeRect), null);
    const failing = () => {
      throw new Error('not mounted');
    };
    assert.equal(rangeRect({ state: caret, coordsAtPos: failing }, 1, 2, makeRect), null);
  });

  test('blockIdAtPoint finds the top-level block under the pointer', () => {
    const b4 = findBlockEntry(base.doc, 'b4');
    assert.ok(b4);
    const view = { state: base, posAtCoords: () => ({ pos: b4.pos + 3, inside: b4.pos }) };
    assert.equal(blockIdAtPoint(view, 10, 10), 'b4');
    assert.equal(blockIdAtPoint({ state: base, posAtCoords: () => null }, 10, 10), null);
  });
});

describe('caretAfterSelection', () => {
  test('a text selection collapses to its end', () => {
    const state = select(base, pos('b2', 5), pos('b3', 8));
    assert.equal(caretAfterSelection(state.selection), pos('b3', 8));
  });

  test('a caret, a selected image or a selected rule stay as they are', () => {
    assert.equal(caretAfterSelection(select(base, pos('b8', 2), pos('b8', 2)).selection), null);
    const figures = articleState(FIGURE_BODY);
    const figure = findBlockEntry(figures.doc, 'f1');
    assert.ok(figure);
    assert.equal(caretAfterSelection(NodeSelection.create(figures.doc, figure.pos)), null);
    const rule = findBlockEntry(base.doc, 'b7');
    assert.ok(rule);
    assert.equal(caretAfterSelection(NodeSelection.create(base.doc, rule.pos)), null);
  });
});
