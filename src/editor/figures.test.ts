import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { redo, undo } from '@tiptap/pm/history';
import { Fragment, Slice } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { figureBlock, paragraphBlock } from '../domain/index.ts';
import { blockKindAt } from './commands.ts';
import { articleSchema } from './extensions.ts';
import {
  coverOf,
  dispatchImageStep,
  figureAt,
  figurePlacementAt,
  figurePlacementAtPos,
  figureRect,
  figuresIn,
  findFigure,
  foreignFigures,
  insertFigureTransaction,
  isFigureDisplayTransaction,
  removeFigureTransaction,
  setCoverTransaction,
  setFigureSourcesTransaction,
  updateFigureTransaction,
} from './figures.ts';
import { docBody } from './nodes.ts';
import { blockEntries, findBlockEntry, offsetToPos, positionsToTextRanges } from './ranges.ts';
import { selectionInfo } from './selection.ts';
import { streamKey, streamState } from './streaming.ts';
import type { StreamMeta } from './streaming.ts';
import { articleState, FIGURE_BODY, testView } from './test-support.ts';

const schema = articleSchema();

function ids(state: EditorState): (string | null)[] {
  return blockEntries(state.doc).map((entry) => entry.id);
}

function caretIn(state: EditorState, blockId: string, offset: number): EditorState {
  const entry = findBlockEntry(state.doc, blockId);
  assert.ok(entry);
  const pos = offsetToPos(entry, offset);
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

function selectFigure(state: EditorState, blockId: string): EditorState {
  const figure = findFigure(state.doc, blockId);
  assert.ok(figure);
  return state.apply(state.tr.setSelection(NodeSelection.create(state.doc, figure.pos)));
}

function dispatch(view: ReturnType<typeof testView>, tr: Transaction | null | undefined): void {
  assert.ok(tr);
  view.dispatch(tr);
}

const SIMPLE = { blocks: [paragraphBlock('p1', 'Olá mundo'), paragraphBlock('p2', 'Fim')] };

describe('reading figures', () => {
  const state = articleState(FIGURE_BODY);

  test('figuresIn and findFigure return the ImageRef, display data, position and index', () => {
    assert.deepEqual(
      figuresIn(state.doc).map((figure) => [figure.blockId, figure.index, figure.assetId, figure.caption]),
      [
        ['f1', 1, 'ast-1', 'Ana Prado corta o couro'],
        ['f2', 3, 'ast-2', null],
      ],
    );
    const f1 = findFigure(state.doc, 'f1');
    assert.equal(state.doc.nodeAt(f1?.pos ?? -1)?.type.name, 'figure');
    assert.equal(findFigure(state.doc, 'p1'), null);
  });

  test('figureAt: only a selected figure', () => {
    assert.equal(figureAt(selectFigure(state, 'f2').selection)?.blockId, 'f2');
    assert.equal(figureAt(caretIn(state, 'p1', 2).selection), null);
  });

  test('a selected figure: block kind, selection facts, no text ranges', () => {
    const selected = selectFigure(state, 'f1');
    assert.equal(blockKindAt(selected), 'figure');
    const info = selectionInfo(selected);
    assert.equal(info.figureId, 'f1');
    assert.equal(info.empty, true, 'no text selected: the text toolbar stays closed');
    assert.deepEqual(info.ranges, []);
    assert.equal(info.text, '');
    assert.equal(info.label, null);
    assert.equal(selectionInfo(caretIn(state, 'p1', 1)).figureId, null);
    // A selection across a figure addresses the text blocks around it only.
    const p1 = findBlockEntry(state.doc, 'p1');
    const p2 = findBlockEntry(state.doc, 'p2');
    assert.ok(p1 && p2);
    assert.deepEqual(
      positionsToTextRanges(state.doc, p1.pos + 2, p2.pos + 3).map((range) => range.blockId),
      ['p1', 'p2'],
    );
  });

  test('the cover is read from the document', () => {
    assert.deepEqual(coverOf(state.doc), FIGURE_BODY.cover);
    assert.equal(coverOf(articleState(SIMPLE).doc), null);
  });

  test('figureRect is the figure DOM rectangle (the image toolbar anchor)', () => {
    const f2 = findFigure(state.doc, 'f2');
    const rect = { x: 1, y: 2, width: 3, height: 4 } as DOMRect;
    const nodeDOM = (pos: number) => (pos === f2?.pos ? { getBoundingClientRect: () => rect } : null);
    assert.equal(figureRect({ state, nodeDOM }, 'f2'), rect);
    assert.equal(figureRect({ state, nodeDOM }, 'f1'), null);
    assert.equal(figureRect({ state, nodeDOM, isDestroyed: true }, 'f2'), null);
    assert.equal(figureRect({ state, nodeDOM }, 'gone'), null);
  });
});

describe('placement', () => {
  const state = articleState({ blocks: [paragraphBlock('p1', 'Olá mundo'), paragraphBlock('empty', ''), figureBlock('f1', { assetId: 'a' }), paragraphBlock('p2', 'Fim')] });

  test('caret inside a block → below it; at its start or on an empty line → above it', () => {
    assert.deepEqual(figurePlacementAt(caretIn(state, 'p1', 4)), { after: 'p1' });
    assert.deepEqual(figurePlacementAt(caretIn(state, 'p1', 9)), { after: 'p1' });
    assert.deepEqual(figurePlacementAt(caretIn(state, 'p1', 0)), { before: 'p1' });
    assert.deepEqual(figurePlacementAt(caretIn(state, 'empty', 0)), { before: 'empty' });
  });

  test('a selected block or a range → below it', () => {
    assert.deepEqual(figurePlacementAt(selectFigure(state, 'f1')), { after: 'f1' });
    const p1 = findBlockEntry(state.doc, 'p1');
    const p2 = findBlockEntry(state.doc, 'p2');
    assert.ok(p1 && p2);
    const range = state.apply(state.tr.setSelection(TextSelection.create(state.doc, p1.pos + 2, p2.pos + 2)));
    assert.deepEqual(figurePlacementAt(range), { after: 'p2' });
  });

  test('a drop point between blocks, on a figure, or off the text', () => {
    const f1 = findFigure(state.doc, 'f1');
    assert.ok(f1);
    assert.deepEqual(figurePlacementAtPos(state.doc, f1.pos), { before: 'f1' });
    assert.deepEqual(figurePlacementAtPos(state.doc, f1.pos + 1), { before: 'p2' });
    assert.deepEqual(figurePlacementAtPos(state.doc, state.doc.content.size), { after: 'p2' });
    assert.deepEqual(figurePlacementAtPos(state.doc, 9999), { after: 'p2' });
  });
});

describe('insertFigure', () => {
  test('at the caret: below the block, one undoable step, caret on the line after, new block id', () => {
    const view = testView(caretIn(articleState(SIMPLE, { history: true }), 'p1', 3));
    const result = insertFigureTransaction(view.state, { assetId: 'ast-1', alt: 'Alt', caption: 'Legenda', src: 'blob:x', credit: 'Ana' });
    assert.ok(result);
    view.dispatch(result.tr);
    assert.deepEqual(ids(view.state), ['p1', 'blk-test01-1', 'p2']);
    const figure = findFigure(view.state.doc, 'blk-test01-1');
    assert.deepEqual([figure?.assetId, figure?.alt, figure?.caption, figure?.src, figure?.credit], ['ast-1', 'Alt', 'Legenda', 'blob:x', 'Ana']);
    assert.equal(view.state.selection.$from.parent.attrs.blockId, 'p2');
    assert.equal(view.state.selection.from, findBlockEntry(view.state.doc, 'p2')!.pos + 1);
    const body = docBody(view.state.doc, { title: '' });
    assert.deepEqual(body.blocks[1], { id: 'blk-test01-1', type: 'figure', image: { assetId: 'ast-1', alt: 'Alt', caption: 'Legenda' } });
    undo(view.state, view.dispatch);
    assert.deepEqual(ids(view.state), ['p1', 'p2']);
  });

  test('typing right after inserting is a separate ⌘Z step', () => {
    const view = testView(caretIn(articleState(SIMPLE, { history: true }), 'p1', 3));
    const result = insertFigureTransaction(view.state, { assetId: 'ast-1' });
    assert.ok(result);
    dispatchImageStep(view, result.tr);
    view.dispatch(view.state.tr.insertText('Legenda digitada'));
    undo(view.state, view.dispatch);
    assert.equal(view.state.doc.textContent.includes('Legenda digitada'), false);
    assert.equal(figuresIn(view.state.doc).length, 1);
    undo(view.state, view.dispatch);
    assert.equal(figuresIn(view.state.doc).length, 0);
  });

  test('as the last block a new empty line follows for the caret', () => {
    const view = testView(caretIn(articleState({ blocks: [paragraphBlock('p1', 'Texto')] }), 'p1', 5));
    dispatch(view, insertFigureTransaction(view.state, { assetId: 'ast-1' })?.tr);
    assert.deepEqual(
      blockEntries(view.state.doc).map((entry) => entry.node.type.name),
      ['paragraph', 'figure', 'paragraph'],
    );
    assert.equal(view.state.selection.$from.parent.type.name, 'paragraph');
    assert.equal(view.state.selection.$from.index(0), 2);
  });

  test('on an empty line the image goes above it and the caret stays on the line', () => {
    const view = testView(caretIn(articleState({ blocks: [paragraphBlock('p1', 'Texto'), paragraphBlock('empty', '')] }), 'empty', 0));
    dispatch(view, insertFigureTransaction(view.state, { assetId: 'ast-1' })?.tr);
    assert.deepEqual(ids(view.state), ['p1', 'blk-test01-1', 'empty']);
    assert.equal(view.state.selection.$from.parent.attrs.blockId, 'empty');
  });

  test('next to a block (an upload that finished) the selection only maps; a missing anchor goes to the end', () => {
    const start = caretIn(articleState(SIMPLE), 'p2', 1);
    const view = testView(start);
    const before = view.state.selection.$from.parent.attrs.blockId;
    dispatch(view, insertFigureTransaction(view.state, { assetId: 'ast-1', blockId: 'fig-a' }, { before: 'p1' })?.tr);
    assert.deepEqual(ids(view.state), ['fig-a', 'p1', 'p2']);
    assert.equal(view.state.selection.$from.parent.attrs.blockId, before);
    assert.equal(view.state.selection.$from.parentOffset, 1);
    dispatch(view, insertFigureTransaction(view.state, { assetId: 'ast-2', blockId: 'fig-b' }, { after: 'deleted-meanwhile' })?.tr);
    assert.deepEqual(ids(view.state), ['fig-a', 'p1', 'p2', 'fig-b']);
  });

  test('at the end: above the empty caret line; refused without an asset', () => {
    const view = testView(articleState({ blocks: [paragraphBlock('p1', 'Texto'), paragraphBlock('caret', '')] }));
    dispatch(view, insertFigureTransaction(view.state, { assetId: 'ast-1', blockId: 'fig' }, 'end')?.tr);
    assert.deepEqual(ids(view.state), ['p1', 'fig', 'caret']);
    assert.equal(insertFigureTransaction(view.state, { assetId: '' }), null);
  });

  test('a duplicated figure id (copy and paste) is reassigned on the copy', () => {
    const view = testView(articleState(FIGURE_BODY));
    const f1 = findFigure(view.state.doc, 'f1');
    assert.ok(f1);
    const copy = view.state.doc.nodeAt(f1.pos);
    assert.ok(copy);
    const end = view.state.doc.content.size;
    view.dispatch(view.state.tr.replace(end, end, new Slice(Fragment.from(copy), 0, 0)));
    const figures = figuresIn(view.state.doc);
    assert.equal(figures.filter((figure) => figure.blockId === 'f1').length, 1);
    assert.equal(figures[0].blockId, 'f1');
    assert.equal(figures.length, 3);
  });
});

describe('updateFigure and removeFigure', () => {
  test('alt and caption are one undoable content step', () => {
    const view = testView(articleState(FIGURE_BODY, { history: true }));
    const tr = updateFigureTransaction(view.state, 'f2', { caption: 'Nova legenda', alt: 'Texto alternativo' });
    assert.ok(tr);
    assert.equal(isFigureDisplayTransaction(tr), false);
    view.dispatch(tr);
    assert.deepEqual(docBody(view.state.doc).blocks[3], { id: 'f2', type: 'figure', image: { assetId: 'ast-2', alt: 'Texto alternativo', caption: 'Nova legenda' } });
    undo(view.state, view.dispatch);
    assert.equal(findFigure(view.state.doc, 'f2')?.caption, null);
    assert.equal(updateFigureTransaction(view.state, 'f2', { caption: null }), null);
    assert.equal(updateFigureTransaction(view.state, 'missing', { caption: 'x' }), null);
  });

  test('display fields only make a display transaction (no history, no update)', () => {
    const view = testView(articleState(FIGURE_BODY, { history: true }));
    const tr = updateFigureTransaction(view.state, 'f1', { src: 'blob:y', credit: 'Ana Prado' });
    assert.ok(tr);
    assert.equal(isFigureDisplayTransaction(tr), true);
    assert.equal(tr.getMeta('addToHistory'), false);
    assert.equal(tr.getMeta('preventUpdate'), true);
    view.dispatch(tr);
    assert.equal(findFigure(view.state.doc, 'f1')?.credit, 'Ana Prado');
    assert.equal(undo(view.state), false);
  });

  test('adopting a pasted image with history: false keeps it out of ⌘Z', () => {
    const state = articleState({ blocks: [paragraphBlock('p1', 'Texto')] }, { history: true });
    const view = testView(state);
    const node = schema.nodes.figure.create({ blockId: 'fx', src: 'https://example.com/a.jpg', alt: 'Praça' });
    view.dispatch(view.state.tr.insert(view.state.doc.content.size, node));
    assert.deepEqual(foreignFigures(view.state.doc), [{ blockId: 'fx', url: 'https://example.com/a.jpg', alt: 'Praça' }]);
    assert.deepEqual(docBody(view.state.doc).blocks.map((block) => block.id), ['p1']);
    const adopt = updateFigureTransaction(view.state, 'fx', { assetId: 'ast-link' }, { history: false });
    assert.ok(adopt);
    assert.equal(adopt.getMeta('addToHistory'), false);
    view.dispatch(adopt);
    assert.deepEqual(foreignFigures(view.state.doc), []);
    assert.deepEqual(docBody(view.state.doc).blocks.map((block) => block.id), ['p1', 'fx']);
    undo(view.state, view.dispatch);
    assert.deepEqual(ids(view.state), ['p1']);
  });

  test('removing: one undoable step; the caret goes to text, never onto another image', () => {
    const view = testView(selectFigure(articleState({ blocks: [paragraphBlock('p1', 'A'), figureBlock('f1', { assetId: 'a' }), figureBlock('f2', { assetId: 'b' })] }, { history: true }), 'f1'));
    dispatch(view, removeFigureTransaction(view.state, 'f1'));
    assert.deepEqual(ids(view.state), ['p1', 'f2']);
    assert.equal(view.state.selection instanceof TextSelection, true);
    undo(view.state, view.dispatch);
    assert.deepEqual(ids(view.state), ['p1', 'f1', 'f2']);
    redo(view.state, view.dispatch);
    assert.deepEqual(ids(view.state), ['p1', 'f2']);
  });

  test('removing the only block leaves an empty line', () => {
    const view = testView(articleState({ blocks: [figureBlock('f1', { assetId: 'a' })] }));
    dispatch(view, removeFigureTransaction(view.state, 'f1'));
    assert.deepEqual(blockEntries(view.state.doc).map((entry) => entry.node.type.name), ['paragraph']);
    assert.equal(removeFigureTransaction(view.state, 'f1'), null);
  });
});

describe('figure sources (display data)', () => {
  const sources = new Map([
    ['ast-1', { src: 'blob:http://localhost/1', credit: 'Ana Prado' }],
    ['ast-2', { src: 'https://example.com/2.jpg' }],
  ]);

  test('sets what each figure shows, outside history and autosave, and the body does not change', () => {
    const view = testView(articleState(FIGURE_BODY, { history: true }));
    const before = docBody(view.state.doc, { title: FIGURE_BODY.title });
    const tr = setFigureSourcesTransaction(view.state, sources);
    assert.equal(isFigureDisplayTransaction(tr), true);
    assert.equal(tr.getMeta('preventUpdate'), true);
    view.dispatch(tr);
    assert.deepEqual([findFigure(view.state.doc, 'f1')?.src, findFigure(view.state.doc, 'f1')?.credit], ['blob:http://localhost/1', 'Ana Prado']);
    assert.equal(findFigure(view.state.doc, 'f2')?.src, 'https://example.com/2.jpg');
    assert.deepEqual(docBody(view.state.doc, { title: FIGURE_BODY.title }), before);
    assert.equal(undo(view.state), false);
  });

  test('a figure that comes back without display data (undo, paste, rebuilt block) picks it up', () => {
    const view = testView(articleState(FIGURE_BODY, { history: true }));
    view.dispatch(setFigureSourcesTransaction(view.state, sources));
    dispatch(view, removeFigureTransaction(view.state, 'f1'));
    undo(view.state, view.dispatch);
    assert.equal(findFigure(view.state.doc, 'f1')?.src, 'blob:http://localhost/1');
    // A block rebuilt from the domain body (no display attrs) is filled in by the plugin.
    const f2 = findFigure(view.state.doc, 'f2');
    assert.ok(f2);
    view.dispatch(view.state.tr.replaceWith(f2.pos, f2.pos + 1, schema.nodes.figure.create({ blockId: 'f2', assetId: 'ast-2' })));
    assert.equal(findFigure(view.state.doc, 'f2')?.src, 'https://example.com/2.jpg');
  });

  test('the credit follows the asset; figures of unknown assets keep what they show', () => {
    const view = testView(articleState(FIGURE_BODY));
    view.dispatch(setFigureSourcesTransaction(view.state, sources));
    view.dispatch(setFigureSourcesTransaction(view.state, new Map([['ast-1', { src: 'blob:http://localhost/1' }]])));
    assert.equal(findFigure(view.state.doc, 'f1')?.credit, null);
    assert.equal(findFigure(view.state.doc, 'f2')?.src, 'https://example.com/2.jpg');
  });

  test('display data synced during a generation is not an edit by the person', () => {
    const view = testView(articleState(FIGURE_BODY));
    const begin: StreamMeta = { type: 'begin', runId: 'run-1', mode: 'append', inFlight: [], owned: [] };
    view.dispatch(view.state.tr.setMeta(streamKey, begin));
    view.dispatch(setFigureSourcesTransaction(view.state, sources));
    assert.equal(streamState(view.state).edited, false);
    dispatch(view, updateFigureTransaction(view.state, 'f2', { caption: 'Legenda' }));
    assert.equal(streamState(view.state).edited, true);
  });
});

describe('cover', () => {
  test('setting, replacing and removing the cover: undoable steps that reach the body', () => {
    const view = testView(articleState(SIMPLE, { history: true }));
    dispatch(view, setCoverTransaction(view.state, { assetId: 'ast-capa', alt: ' Fachada ', caption: '' }));
    assert.deepEqual(docBody(view.state.doc).cover, { assetId: 'ast-capa', alt: 'Fachada' });
    assert.equal(setCoverTransaction(view.state, { assetId: 'ast-capa', alt: 'Fachada' }), null);
    dispatch(view, setCoverTransaction(view.state, null));
    assert.equal('cover' in docBody(view.state.doc), false);
    undo(view.state, view.dispatch);
    assert.deepEqual(coverOf(view.state.doc), { assetId: 'ast-capa', alt: 'Fachada' });
    undo(view.state, view.dispatch);
    assert.equal(coverOf(view.state.doc), null);
  });

  test('the cover survives replacing the text (a generation in replace mode)', () => {
    const view = testView(articleState(FIGURE_BODY));
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, schema.nodes.paragraph.create()));
    assert.deepEqual(coverOf(view.state.doc), FIGURE_BODY.cover);
  });
});
