import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { Plugin } from '@tiptap/pm/state';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { figureBlock, paragraphBlock } from '../domain/index.ts';
import { articleSchema } from './extensions.ts';
import type { FigurePlacement, ForeignFigure } from './figures.ts';
import { findFigure } from './figures.ts';
import { dropPlacement, imageInputPlugin, pastedImageFiles, withoutForeignFigures } from './image-input.ts';
import type { ImageInputOptions, TransferLike } from './image-input.ts';
import { findBlockEntry, offsetToPos } from './ranges.ts';
import { articleState } from './test-support.ts';

const schema = articleSchema();

const png = (name = 'foto.png') => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });
const pdf = () => new File([new Uint8Array([37, 80, 68, 70])], 'pauta.pdf', { type: 'application/pdf' });

function transfer(files: File[], data: Record<string, string> = {}): TransferLike {
  return { files, getData: (format) => data[format] ?? '' };
}

const BODY = { blocks: [paragraphBlock('p1', 'Olá mundo'), paragraphBlock('p2', 'Fim')] };

function caretIn(state: EditorState, blockId: string, offset: number): EditorState {
  const entry = findBlockEntry(state.doc, blockId);
  assert.ok(entry);
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, offsetToPos(entry, offset))));
}

type Calls = { files: [File[], FigurePlacement][]; rejected: File[][]; foreign: ForeignFigure[][] };

function setup(options: { handlers?: Partial<Record<keyof ImageInputOptions, boolean>>; state?: EditorState } = {}) {
  const calls: Calls = { files: [], rejected: [], foreign: [] };
  const on = options.handlers ?? { onImageFiles: true, onRejectedFiles: true, onForeignImages: true };
  const plugin: Plugin = imageInputPlugin({
    onImageFiles: on.onImageFiles ? (files, placement) => calls.files.push([files, placement]) : undefined,
    onRejectedFiles: on.onRejectedFiles ? (files) => calls.rejected.push(files) : undefined,
    onForeignImages: on.onForeignImages ? (images) => calls.foreign.push(images) : undefined,
  });
  const state = options.state ?? caretIn(articleState(BODY), 'p1', 4);
  const view = {
    state,
    posAtCoords: ({ top }: { left: number; top: number }) => (top < 0 ? null : { pos: top, inside: -1 }),
  } as unknown as EditorView;
  return { plugin, view, calls };
}

function paste(plugin: Plugin, view: EditorView, data: TransferLike): boolean {
  const event = { clipboardData: data } as unknown as ClipboardEvent;
  return Boolean(plugin.props.handlePaste?.call(plugin, view, event, Slice.empty));
}

function drop(plugin: Plugin, view: EditorView, files: File[], options: { y?: number; slice?: Slice; moved?: boolean } = {}): boolean {
  const event = { dataTransfer: transfer(files), clientX: 10, clientY: options.y ?? 1 } as unknown as DragEvent;
  return Boolean(plugin.props.handleDrop?.call(plugin, view, event, options.slice ?? Slice.empty, options.moved ?? false));
}

describe('pastedImageFiles', () => {
  test('a screenshot or a copied image file is handed over', () => {
    const shot = png();
    assert.deepEqual(pastedImageFiles(transfer([shot])), [shot]);
    // Finder puts the file name as text next to the file.
    assert.deepEqual(pastedImageFiles(transfer([shot], { 'text/plain': 'foto.png' })), [shot]);
  });

  test('"Copy image" in a browser: HTML with only the image, plus the file → the file', () => {
    const file = png('image.png');
    const html = '<meta charset="utf-8"><html><body><!--StartFragment--><img src="https://example.com/a.png" alt="A"/><!--EndFragment--></body></html>';
    assert.deepEqual(pastedImageFiles(transfer([file], { 'text/html': html })), [file]);
  });

  test('text with a picture of itself (Word, Sheets) pastes as text', () => {
    const html = '<html><head><style>p { margin: 0 }</style></head><body><p>Receita cresceu&nbsp;20%</p></body></html>';
    assert.deepEqual(pastedImageFiles(transfer([png()], { 'text/html': html, 'text/plain': 'Receita cresceu 20%' })), []);
    assert.deepEqual(pastedImageFiles(transfer([png()], { 'text/plain': 'Uma frase copiada' })), []);
  });

  test('nothing to hand over without image files', () => {
    assert.deepEqual(pastedImageFiles(transfer([], { 'text/plain': 'texto' })), []);
    assert.deepEqual(pastedImageFiles(transfer([pdf()])), []);
  });
});

describe('paste', () => {
  test('image files go to onImageFiles with a placement at the caret; nothing is inserted', () => {
    const { plugin, view, calls } = setup();
    const file = png();
    assert.equal(paste(plugin, view, transfer([file])), true);
    assert.deepEqual(calls.files, [[[file], { after: 'p1' }]]);
  });

  test('text pastes as before; without a handler files paste as before', () => {
    const { plugin, view, calls } = setup();
    assert.equal(paste(plugin, view, transfer([], { 'text/plain': 'olá' })), false);
    assert.equal(paste(plugin, view, transfer([png()], { 'text/plain': 'Uma frase copiada' })), false);
    assert.equal(calls.files.length, 0);
    const bare = setup({ handlers: {} });
    assert.equal(paste(bare.plugin, bare.view, transfer([png()])), false);
  });
});

describe('drop', () => {
  test('image files go to onImageFiles with the placement under the pointer; other files are left out', () => {
    const { plugin, view, calls } = setup();
    const p2 = findBlockEntry(view.state.doc, 'p2');
    assert.ok(p2);
    const image = png();
    assert.equal(drop(plugin, view, [pdf(), image], { y: p2.pos + 1 }), true);
    assert.deepEqual(calls.files, [[[image], { before: 'p2' }]]);
    assert.deepEqual(dropPlacement(view, { clientX: 0, clientY: p2.pos + 3 }), { after: 'p2' });
    // Off the text: the caret placement.
    assert.deepEqual(dropPlacement(view, { clientX: 0, clientY: -1 }), { after: 'p1' });
  });

  test('moving content, dropping text and dropping without files behave as before', () => {
    const { plugin, view, calls } = setup();
    assert.equal(drop(plugin, view, [png()], { moved: true }), false);
    assert.equal(drop(plugin, view, []), false);
    const text = new Slice(Fragment.from(schema.text('x')), 0, 0);
    assert.equal(drop(plugin, view, [pdf()], { slice: text }), false);
    assert.equal(calls.files.length, 0);
  });

  test('a dropped file that is not an image is reported and not opened by the browser', () => {
    const { plugin, view, calls } = setup();
    const file = pdf();
    assert.equal(drop(plugin, view, [file]), true);
    assert.deepEqual(calls.rejected, [[file]]);
  });
});

describe('images pasted from another page', () => {
  const foreign = () => schema.nodes.figure.create({ src: 'https://example.com/a.jpg', alt: 'Praça' });
  const ours = () => schema.nodes.figure.create({ assetId: 'ast-1' });

  test('without onForeignImages they are left out of the paste (they could never be saved)', () => {
    const slice = new Slice(Fragment.from([schema.nodes.paragraph.create(null, schema.text('a')), foreign(), ours()]), 1, 0);
    const kept = withoutForeignFigures(slice);
    assert.deepEqual(
      Array.from({ length: kept.content.childCount }, (_, index) => kept.content.child(index).type.name),
      ['paragraph', 'figure'],
    );
    assert.equal(kept.openStart, 1);
    assert.equal(withoutForeignFigures(new Slice(Fragment.from(foreign()), 0, 0)).size, 0);
    const { plugin } = setup({ handlers: { onImageFiles: true } });
    const transformed = plugin.props.transformPasted?.call(plugin, slice, {} as EditorView, false);
    assert.equal(transformed?.content.childCount, 2);
    const withHandler = setup();
    assert.equal(withHandler.plugin.props.transformPasted?.call(withHandler.plugin, slice, {} as EditorView, false), slice);
  });

  test('each one is reported once, after the paste settles, for the host to adopt as a link asset', async () => {
    const state = articleState({ blocks: [paragraphBlock('p1', 'Texto'), figureBlock('f1', { assetId: 'ast-1' })] });
    const { plugin, view, calls } = setup({ state });
    const pluginView = plugin.spec.view?.(view);
    assert.ok(pluginView?.update);
    const next = state.apply(state.tr.insert(state.doc.content.size, foreign()));
    const figureId = next.doc.lastChild?.attrs.blockId as string;
    assert.ok(figureId);
    pluginView.update({ ...view, state: next } as EditorView, state);
    pluginView.update({ ...view, state: next.apply(next.tr.insertText('!', 2)) } as EditorView, next);
    assert.equal(calls.foreign.length, 0);
    await Promise.resolve();
    assert.deepEqual(calls.foreign, [[{ blockId: figureId, url: 'https://example.com/a.jpg', alt: 'Praça' }]]);
    assert.equal(findFigure(next.doc, figureId)?.assetId, null);
  });
});

describe('a click on a caption', () => {
  test('reports the figure to edit its caption; clicks on the picture or in a read-only text do not', () => {
    const state = articleState({ blocks: [paragraphBlock('p1', 'Texto'), figureBlock('f1', { assetId: 'a', caption: 'Legenda' })] });
    const edits: string[] = [];
    const plugin = imageInputPlugin({ onFigureCaption: (blockId) => edits.push(blockId) });
    const figure = findFigure(state.doc, 'f1');
    assert.ok(figure);
    const node = state.doc.nodeAt(figure.pos);
    const click = (insideCaption: boolean, editable = true) => {
      const view = { state, editable } as unknown as EditorView;
      const event = { target: { closest: (selector: string) => (selector === 'figcaption' && insideCaption ? {} : null) } } as unknown as MouseEvent;
      return plugin.props.handleClickOn?.call(plugin, view, figure.pos + 1, node as never, figure.pos, event, true);
    };
    assert.equal(click(true), false, 'the figure is still selected as a whole');
    click(false);
    click(true, false);
    assert.deepEqual(edits, ['f1']);
  });
});
