import type { Editor } from '@tiptap/react';
import type { EditorState } from '@tiptap/pm/state';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { normalizeLink } from '../domain/index.ts';
import type { ArticleBlock, ArticleBody, BlockId, ImageRef, LinkResult } from '../domain/index.ts';
import {
  dispatchImageStep,
  insertFigureTransaction,
  isFigureNode,
  removeFigureTransaction,
  sameImageRef,
  setCoverTransaction,
  setFigureSourcesTransaction,
  updateFigureTransaction,
} from './figures.ts';
import type { FigureInput, FigurePatch, FigureWhere } from './figures.ts';
import { blockNode, articleDocNode } from './nodes.ts';
import { readImageRef } from './pm-json.ts';
import type { FigureSources } from './pm-json.ts';
import { findBlockEntry } from './ranges.ts';
import { BLOCK_ATTR, DOC_ATTR, MARK, NODE } from './schema.ts';

/**
 * Toolbar and studio actions on a TipTap editor, named by what the person picks (the semantic
 * toolbar: Estilo ▾ Texto · Intertítulo · Subtítulo · Citação, B I U S, listas, link).
 */

export type BlockKind = 'paragraph' | 'heading2' | 'heading3' | 'quote' | 'bulletList' | 'orderedList';
export type MarkKind = 'bold' | 'italic' | 'underline' | 'strike';

/** Block style at the selection head; `divider`/`figure` for a selected rule or image; `null` before content. */
export function blockKindAt(state: EditorState): BlockKind | 'divider' | 'figure' | null {
  const { $from } = state.selection;
  const node = $from.depth > 0 ? $from.node(1) : (state.doc.nodeAt($from.pos) ?? null);
  if (!node) return null;
  switch (node.type.name) {
    case NODE.heading:
      return node.attrs.level === 3 ? 'heading3' : 'heading2';
    case NODE.quote:
      return 'quote';
    case NODE.bulletList:
      return 'bulletList';
    case NODE.orderedList:
      return 'orderedList';
    case NODE.divider:
      return 'divider';
    case NODE.figure:
      return 'figure';
    default:
      return 'paragraph';
  }
}

export function setBlockKind(editor: Editor, kind: BlockKind): boolean {
  // An image has no text style.
  if (blockKindAt(editor.state) === 'figure') return false;
  const chain = editor.chain().focus();
  // Picking the active list again turns it back into text. `clearNodes` lifts item by item:
  // TipTap's list toggle joins the items first, which a one-paragraph item cannot hold.
  if ((kind === 'bulletList' || kind === 'orderedList') && blockKindAt(editor.state) === kind) return chain.clearNodes().run();
  switch (kind) {
    case 'paragraph':
      return chain.clearNodes().run();
    case 'heading2':
      return chain.clearNodes().setHeading({ level: 2 }).run();
    case 'heading3':
      return chain.clearNodes().setHeading({ level: 3 }).run();
    case 'quote':
      return chain.clearNodes().setNode(NODE.quote).run();
    case 'bulletList':
      return chain.toggleBulletList().run();
    case 'orderedList':
      return chain.toggleOrderedList().run();
  }
}

export function toggleMark(editor: Editor, mark: MarkKind): boolean {
  const chain = editor.chain().focus();
  switch (mark) {
    case 'bold':
      return chain.toggleBold().run();
    case 'italic':
      return chain.toggleItalic().run();
    case 'underline':
      return chain.toggleUnderline().run();
    case 'strike':
      return chain.toggleStrike().run();
  }
}

/**
 * Links the selection (or the link under the caret) to a normalised safe address; with an
 * empty selection outside a link, inserts `label` (or the address) as linked text.
 */
export function setLink(editor: Editor, input: string, label?: string): LinkResult {
  const result = normalizeLink(input);
  if (!result.ok) return result;
  const { href } = result;
  const { empty } = editor.state.selection;
  if (empty && !editor.isActive(MARK.link)) {
    editor
      .chain()
      .focus()
      .insertContent({ type: 'text', text: label?.trim() || href, marks: [{ type: MARK.link, attrs: { href } }] })
      .run();
  } else {
    editor.chain().focus().extendMarkRange(MARK.link).setLink({ href }).run();
  }
  return result;
}

export function unsetLink(editor: Editor): boolean {
  return editor.chain().focus().extendMarkRange(MARK.link).unsetLink().run();
}

export function undo(editor: Editor): boolean {
  return editor.chain().focus().undo().run();
}

export function redo(editor: Editor): boolean {
  return editor.chain().focus().redo().run();
}

/**
 * Puts the caret at the start of a block and scrolls it into view ("next AI block to review"). An
 * image is selected whole, so its toolbar opens ("Imagens com crédito" → the image).
 */
export function focusBlock(editor: Editor, blockId: BlockId, options: { scroll?: boolean } = {}): boolean {
  const entry = findBlockEntry(editor.state.doc, blockId);
  if (!entry) return false;
  const selection = isFigureNode(entry.node)
    ? NodeSelection.create(editor.state.doc, entry.pos)
    : TextSelection.near(editor.state.doc.resolve(entry.pos + 1));
  const tr = editor.state.tr.setSelection(selection);
  const scroll = options.scroll !== false;
  if (scroll) tr.scrollIntoView();
  editor.view.dispatch(tr);
  // Without `scroll`, the caller brings the block into view itself (e.g. to the upper third).
  editor.commands.focus(null, { scrollIntoView: scroll });
  return true;
}

export type InsertWhere = { after: BlockId } | { before: BlockId } | 'selection' | 'end';

/**
 * Inserts domain blocks in one undoable step ("Inserir citação" with its `sourceRefs`).
 * `selection` inserts after the block holding the caret.
 */
export function insertBlocks(editor: Editor, blocks: readonly ArticleBlock[], where: InsertWhere = 'selection'): boolean {
  if (blocks.length === 0) return false;
  const { state } = editor;
  const nodes = blocks.map((block) => blockNode(state.schema, block));
  let pos = state.doc.content.size;
  if (where === 'selection') {
    const { $to } = state.selection;
    pos = $to.depth > 0 ? $to.after(1) : $to.pos;
  } else if (where !== 'end') {
    const target = 'after' in where ? where.after : where.before;
    const entry = findBlockEntry(state.doc, target);
    if (!entry) return false;
    pos = 'after' in where ? entry.pos + entry.node.nodeSize : entry.pos;
  }
  const tr = state.tr.insert(pos, nodes);
  const end = pos + nodes.reduce((size, node) => size + node.nodeSize, 0);
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(0, end - 1)), -1)).scrollIntoView();
  editor.view.dispatch(tr);
  return true;
}

/** Marks AI blocks as reviewed (one undoable step); the "Blocos da IA revisados" check reads it. */
export function markBlocksReviewed(editor: Editor, blockIds: readonly BlockId[]): boolean {
  const tr = editor.state.tr;
  for (const id of blockIds) {
    const entry = findBlockEntry(tr.doc, id);
    if (entry && entry.node.attrs[BLOCK_ATTR.ai] === 'unreviewed') tr.setNodeAttribute(entry.pos, BLOCK_ATTR.ai, 'reviewed');
  }
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr);
  return true;
}

/**
 * Replaces the whole document, cover included (restore a version, reload after a save conflict).
 * Outside the undo history by default, and without an `update` (the store already holds this body).
 */
export function setArticleBody(editor: Editor, body: Pick<ArticleBody, 'blocks' | 'cover'>, options: { history?: boolean; emitUpdate?: boolean } = {}): void {
  const { state } = editor;
  const doc = articleDocNode(state.schema, body);
  const tr = state.tr.replaceWith(0, state.doc.content.size, doc.content);
  const cover = readImageRef(body.cover);
  if (DOC_ATTR.cover in state.doc.attrs && !sameImageRef(readImageRef(state.doc.attrs[DOC_ATTR.cover]), cover)) tr.setDocAttribute(DOC_ATTR.cover, cover);
  if (!options.history) tr.setMeta('addToHistory', false);
  if (!options.emitUpdate) tr.setMeta('preventUpdate', true);
  editor.view.dispatch(tr);
}

// ——— Images ———

/**
 * Inserts an image block ("Inserir imagem") as one undoable step and returns its block id
 * (`null` without an asset). `selection` (default) puts it next to the block holding the caret
 * (above an empty line or when the caret is at the start of a block, below it otherwise) and moves
 * the caret to the line after it; a block placement (`onImageFiles` handed it over) keeps the
 * person's selection where it is.
 */
export function insertFigure(editor: Editor, image: FigureInput, at: FigureWhere = 'selection'): BlockId | null {
  const result = insertFigureTransaction(editor.state, image, at);
  if (!result) return null;
  dispatchImageStep(editor.view, result.tr);
  const id = editor.state.doc.nodeAt(result.pos)?.attrs[BLOCK_ATTR.id];
  return typeof id === 'string' ? id : null;
}

/**
 * Changes an image: alt, caption or asset → one undoable step that saves; `src`/`credit`/size only
 * → display, outside history and autosave. `{ history: false }` when adopting a pasted image.
 */
export function updateFigure(editor: Editor, blockId: BlockId, patch: FigurePatch, options: { history?: boolean } = {}): boolean {
  const tr = updateFigureTransaction(editor.state, blockId, patch, options);
  if (!tr) return false;
  dispatchImageStep(editor.view, tr);
  return true;
}

/** Removes an image block as one undoable step. */
export function removeFigure(editor: Editor, blockId: BlockId): boolean {
  const tr = removeFigureTransaction(editor.state, blockId);
  if (!tr) return false;
  dispatchImageStep(editor.view, tr);
  return true;
}

/**
 * What the figures show, per asset (object URL or link, credit, size). Call it whenever the map
 * changes (keep it memoised); figures added later (paste, undo, restore) pick it up by themselves.
 * Never in the history, never an `update`: the autosave ignores it.
 */
export function setFigureSources(editor: Editor, sources: FigureSources): void {
  if (editor.isDestroyed) return;
  editor.view.dispatch(setFigureSourcesTransaction(editor.state, sources));
}

/**
 * Sets ("Definir como destaque") or removes (`null`) the cover: one undoable step that saves with
 * the text (`onChange` gets the body with `cover`). `false` when nothing changed.
 */
export function setArticleCover(editor: Editor, cover: ImageRef | null): boolean {
  const tr = setCoverTransaction(editor.state, cover);
  if (!tr) return false;
  dispatchImageStep(editor.view, tr);
  return true;
}
