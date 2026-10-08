import { closeHistory } from '@tiptap/pm/history';
import type { DOMOutputSpec, Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, Selection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { creditLine } from '../domain/index.ts';
import type { AiReviewState, AssetId, BlockId, ImageRef, SourceRef } from '../domain/index.ts';
import { EMPTY_BLOCK_ATTRS, figureAttrs, readImageRef } from './pm-json.ts';
import type { FigureAttrs, FigureDisplay, FigureSources } from './pm-json.ts';
import { blockIdOf, blockTextOf, findBlockEntry, posToOffset } from './ranges.ts';
import { DATA_ATTR, DOC_ATTR, FIGURE_ATTR, FIGURE_DISPLAY_ATTRS, NODE } from './schema.ts';
import type { ViewLike } from './view.ts';

/**
 * Images in the article: the `figure` block (an atom: selected and edited as a whole, never typed
 * into) and the cover (a document attribute, not a node).
 *
 * - The domain keeps `ImageRef` only (`assetId`, `alt`, `caption`). What the editor shows besides
 *   (`src`, `credit`, `width`, `height`) is display data synced from the assets: it never enters
 *   the history, never emits an update (so autosave ignores it) and never reaches the body.
 * - `figureSourcesPlugin` holds the latest display data per asset and re-applies it to any figure
 *   that comes back without it (undo, paste, restore, a block rebuilt by a suggestion).
 * - Rendering is plain HTML the Design System `Prose` styles: `figure[data-block-id] > img +
 *   figcaption` (caption, then `cite` with the credit line). Nothing here creates DOM.
 */

export type FigureInfo = FigureAttrs & {
  blockId: BlockId;
  /** Position before the figure node. */
  pos: number;
  /** Index among the document's top-level blocks (0-based). */
  index: number;
};

/** Where an image goes: next to a block (stable while a file uploads), or at the end of the text. */
export type FigurePlacement = { after: BlockId } | { before: BlockId } | 'end';

/** `selection` = next to the block holding the caret, decided when the command runs. */
export type FigureWhere = FigurePlacement | 'selection';

/** A figure to insert: the domain `ImageRef` plus what to show right away. */
export type FigureInput = ImageRef & FigureDisplay & { blockId?: BlockId; sourceRefs?: SourceRef[]; ai?: AiReviewState };

/** `null` clears a field; `assetId` adopts an image pasted from another page. */
export type FigurePatch = {
  assetId?: AssetId;
  alt?: string | null;
  caption?: string | null;
  credit?: string | null;
  src?: string | null;
  width?: number | null;
  height?: number | null;
};

/** An image pasted from another page: shown, but not content until an asset adopts it. */
export type ForeignFigure = { blockId: BlockId; url: string; alt?: string; caption?: string; credit?: string };

export const FIGURE_DISPLAY_META = 'reporterFigureDisplay';

export const EMPTY_FIGURE_SOURCES: FigureSources = new Map();

// ——— Reading ———

export function isFigureNode(node: PMNode | null | undefined): boolean {
  return node?.type.name === NODE.figure;
}

/** Figure attributes of a node, typed (unknown values become `null`). */
export function readFigureAttrs(attrs: Record<string, unknown>): FigureAttrs {
  return figureAttrs(
    { assetId: asText(attrs[FIGURE_ATTR.assetId]), alt: asText(attrs[FIGURE_ATTR.alt]), caption: asText(attrs[FIGURE_ATTR.caption]) },
    {
      credit: asText(attrs[FIGURE_ATTR.credit]),
      src: asText(attrs[FIGURE_ATTR.src]),
      width: asNumber(attrs[FIGURE_ATTR.width]),
      height: asNumber(attrs[FIGURE_ATTR.height]),
    },
  );
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function infoOf(node: PMNode, pos: number, index: number): FigureInfo | null {
  const blockId = blockIdOf(node);
  if (!isFigureNode(node) || !blockId) return null;
  return { ...readFigureAttrs(node.attrs), blockId, pos, index };
}

/** Every figure of the document, in order. */
export function figuresIn(doc: PMNode): FigureInfo[] {
  const figures: FigureInfo[] = [];
  doc.forEach((node, pos, index) => {
    const info = infoOf(node, pos, index);
    if (info) figures.push(info);
  });
  return figures;
}

export function findFigure(doc: PMNode, blockId: BlockId): FigureInfo | null {
  const entry = findBlockEntry(doc, blockId);
  return entry ? infoOf(entry.node, entry.pos, entry.index) : null;
}

/** The figure a selection holds (a click on an image selects it whole), or `null`. */
export function figureAt(selection: Selection): FigureInfo | null {
  if (!(selection instanceof NodeSelection) || selection.$from.depth !== 0) return null;
  return infoOf(selection.node, selection.from, selection.$from.index(0));
}

/** Images pasted from another page that no asset adopted yet (`url` = the `http(s)` address). */
export function foreignFigures(doc: PMNode): ForeignFigure[] {
  return figuresIn(doc).flatMap((figure) => {
    const url = linkSrc(figure.src);
    if (figure.assetId || !url) return [];
    const image: ForeignFigure = { blockId: figure.blockId, url };
    if (figure.alt) image.alt = figure.alt;
    if (figure.caption) image.caption = figure.caption;
    if (figure.credit) image.credit = figure.credit;
    return [image];
  });
}

/** The article cover held by the document, or `null`. */
export function coverOf(doc: PMNode): ImageRef | null {
  return readImageRef(doc.attrs[DOC_ATTR.cover]);
}

// ——— HTML (Prose hooks) ———

const DISPLAYABLE_SRC = /^(https?:|blob:|data:image\/)/i;
const LINK_SRC = /^https?:\/\//i;

/** A `src` the editor may show (http(s), object URL or inline image); anything else is dropped. */
export function displayableSrc(src: unknown): string | null {
  return typeof src === 'string' && DISPLAYABLE_SRC.test(src.trim()) ? src.trim() : null;
}

function linkSrc(src: unknown): string | null {
  return typeof src === 'string' && LINK_SRC.test(src.trim()) ? src.trim() : null;
}

/** Between the caption and the credit line in the figcaption. */
const CAPTION_CREDIT_SEPARATOR = ' — ';

/**
 * `figure[data-block-id][data-asset-id] > img[src][alt] + figcaption(caption — cite "Foto: …")`, the
 * same line as the review, the diff and the exported .md/.html ("Legenda — Foto: Crédito").
 * Empty parts are left out; without a file the `img` has no `src` and carries `data-missing`.
 */
/**
 * Tallest a figure is drawn in the text, in CSS pixels. Prose draws images at most as wide as the
 * column and keeps their proportion from the `width`/`height` attributes, so a portrait phone
 * photo would be taller than the window; its attributes are scaled to this height instead (the
 * picture keeps its proportion and its file; only the size on screen changes).
 */
export const FIGURE_MAX_HEIGHT = 560;

/** The `width`/`height` a figure is drawn with: the image's own, scaled down to `FIGURE_MAX_HEIGHT`. */
export function figureDisplaySize(width: number, height: number): { width: number; height: number } {
  if (height <= FIGURE_MAX_HEIGHT) return { width, height };
  return { width: Math.max(1, Math.round((width * FIGURE_MAX_HEIGHT) / height)), height: FIGURE_MAX_HEIGHT };
}

export function figureDOMSpec(attrs: Record<string, unknown>, htmlAttributes: Record<string, unknown> = {}): DOMOutputSpec {
  const figure = readFigureAttrs(attrs);
  const src = displayableSrc(figure.src);
  // `draggable="false"`: the browser would otherwise drag the picture itself out of the atom.
  const img: Record<string, string> = { alt: figure.alt?.trim() ?? '', draggable: 'false' };
  if (src) img.src = src;
  else img[DATA_ATTR.missing] = '';
  if (figure.width && figure.height) {
    const shown = figureDisplaySize(figure.width, figure.height);
    img.width = String(shown.width);
    img.height = String(shown.height);
  }
  const caption = figure.caption?.replace(/\s+/g, ' ').trim();
  const credit = creditLine(figure.credit ?? undefined);
  const outer: Record<string, unknown> = { ...htmlAttributes };
  if (figure.assetId) outer[DATA_ATTR.assetId] = figure.assetId;
  if (!caption && !credit) return ['figure', outer, ['img', img]];
  const captionParts: (string | DOMOutputSpec)[] = [];
  if (caption) captionParts.push(credit ? `${caption}${CAPTION_CREDIT_SEPARATOR}` : caption);
  if (credit) captionParts.push(['cite', credit]);
  return ['figure', outer, ['img', img], ['figcaption', ...captionParts]];
}

/** Pasted images smaller than this (emoji, tracking pixels, icons) are not figures. */
const MIN_PASTED_SIDE = 48;

type ElementLike = Pick<Element, 'nodeName' | 'getAttribute' | 'querySelector' | 'textContent'>;

function tinyImage(img: ElementLike): boolean {
  const width = Number(img.getAttribute('width'));
  const height = Number(img.getAttribute('height'));
  return (width > 0 && width < MIN_PASTED_SIDE) || (height > 0 && height < MIN_PASTED_SIDE);
}

/**
 * Pasted or dropped HTML → figure attributes, or `false` (not an image: the parser goes on).
 * A figure copied from this editor keeps its asset (`data-asset-id`); an image from another page
 * keeps only an `http(s)` address as a candidate for a link asset (see `foreignFigures`). Inline
 * (`data:`) and local files are ignored here: files arrive through `onImageFiles`.
 */
export function parseFigureElement(element: ElementLike): Partial<FigureAttrs> | false {
  const isImg = element.nodeName.toUpperCase() === 'IMG';
  const img = isImg ? element : element.querySelector('img');
  if (!img) return false;
  const assetId = isImg ? null : element.getAttribute(DATA_ATTR.assetId)?.trim() || null;
  const src = assetId ? displayableSrc(img.getAttribute('src')) : linkSrc(img.getAttribute('src'));
  if (!assetId && (!src || tinyImage(img))) return false;
  const attrs: Partial<FigureAttrs> = { assetId, src, alt: img.getAttribute('alt')?.trim() || null };
  const figcaption = isImg ? null : element.querySelector('figcaption');
  if (figcaption) {
    const cite = figcaption.querySelector('cite');
    const citeText = cite?.textContent ?? '';
    const full = figcaption.textContent ?? '';
    // The separator before the credit is display only (see `figureDOMSpec`).
    attrs.caption = (citeText ? full.replace(citeText, '').replace(/\s*—\s*$/, '') : full).replace(/\s+/g, ' ').trim() || null;
    attrs.credit = citeText.replace(/\s+/g, ' ').trim() || null;
  }
  return attrs;
}

// ——— Placement ———

/**
 * Where an image dropped or pasted at `pos` goes: above an empty line (the line stays for the
 * caret) or when the point is at the start of a block, below the block otherwise.
 */
export function figurePlacementAtPos(doc: PMNode, pos: number): FigurePlacement {
  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  const $pos = doc.resolve(clamped);
  if ($pos.depth === 0) {
    const after = $pos.nodeAfter ? blockIdOf($pos.nodeAfter) : null;
    if (after) return { before: after };
    const before = $pos.nodeBefore ? blockIdOf($pos.nodeBefore) : null;
    return before ? { after: before } : 'end';
  }
  const node = $pos.node(1);
  const id = blockIdOf(node);
  if (!id) return 'end';
  if (isFigureNode(node) || node.type.name === NODE.divider) return { after: id };
  if (blockTextOf(node) === '' || posToOffset({ node, pos: $pos.before(1) }, clamped) === 0) return { before: id };
  return { after: id };
}

/** Placement for the selection: after a selected block, after a range, else as at the caret. */
export function figurePlacementAt(state: EditorState): FigurePlacement {
  const { selection } = state;
  if (selection instanceof NodeSelection && selection.$from.depth === 0) {
    const id = blockIdOf(selection.node);
    return id ? { after: id } : 'end';
  }
  if (!selection.empty) {
    const { $to } = selection;
    const id = $to.depth > 0 ? blockIdOf($to.node(1)) : null;
    return id ? { after: id } : 'end';
  }
  return figurePlacementAtPos(state.doc, selection.from);
}

function insertionPos(doc: PMNode, placement: FigurePlacement): number {
  if (placement !== 'end') {
    const entry = findBlockEntry(doc, 'after' in placement ? placement.after : placement.before);
    if (entry) return 'after' in placement ? entry.pos + entry.node.nodeSize : entry.pos;
  }
  // The end of the text: above the empty caret line TipTap keeps last.
  const last = doc.lastChild;
  if (last && last.type.name === NODE.paragraph && last.content.size === 0) return doc.content.size - last.nodeSize;
  return doc.content.size;
}

// ——— Transactions ———

function isTextFlow(node: PMNode | null): boolean {
  return node !== null && !node.isLeaf;
}

/** Marks a transaction as display only: no history, no `update` (autosave), no stream edit. */
export function displayOnly(tr: Transaction): Transaction {
  return tr.setMeta(FIGURE_DISPLAY_META, true).setMeta('addToHistory', false).setMeta('preventUpdate', true);
}

export function isFigureDisplayTransaction(tr: Transaction): boolean {
  return tr.getMeta(FIGURE_DISPLAY_META) === true;
}

/**
 * Dispatches an image change as its own ⌘Z step: what the person types right after it is a new
 * step (display transactions pass straight through).
 */
export function dispatchImageStep(view: ViewLike, tr: Transaction): void {
  view.dispatch(tr);
  if (tr.docChanged && !isFigureDisplayTransaction(tr) && tr.getMeta('addToHistory') !== false) {
    view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false));
  }
}

/**
 * Inserts a figure as one undoable step. With `selection` or `end` (the person asked for it now)
 * the caret goes to the line after the image (a new empty line when none follows) and the image
 * scrolls into view; next to a block (an upload that finished) the person's selection only maps.
 * Returns the transaction and the figure position, or `null` without an asset.
 */
export function insertFigureTransaction(state: EditorState, input: FigureInput, where: FigureWhere = 'selection'): { tr: Transaction; pos: number } | null {
  const type = state.schema.nodes[NODE.figure];
  const attrs = figureAttrs(input, input);
  if (!type || !attrs.assetId) return null;
  const node = type.create({
    ...EMPTY_BLOCK_ATTRS,
    blockId: input.blockId ?? null,
    sourceRefs: input.sourceRefs && input.sourceRefs.length > 0 ? [...input.sourceRefs] : null,
    ai: input.ai ?? null,
    ...attrs,
  });
  const placement = where === 'selection' ? figurePlacementAt(state) : where;
  const pos = insertionPos(state.doc, placement);
  const tr = closeHistory(state.tr).insert(pos, node);
  if (where === 'selection' || where === 'end') {
    const after = pos + node.nodeSize;
    if (!isTextFlow(tr.doc.nodeAt(after))) tr.insert(after, state.schema.nodes[NODE.paragraph].create());
    tr.setSelection(Selection.near(tr.doc.resolve(after + 1), 1)).scrollIntoView();
  }
  return { tr, pos };
}

function patchedAttrs(current: FigureAttrs, patch: FigurePatch): FigureAttrs {
  const pick = <K extends keyof FigurePatch>(key: K, fallback: FigureAttrs[K]) => (key in patch ? (patch[key] ?? undefined) : (fallback ?? undefined));
  return figureAttrs(
    { assetId: pick('assetId', current.assetId), alt: pick('alt', current.alt), caption: pick('caption', current.caption) },
    { credit: pick('credit', current.credit), src: pick('src', current.src), width: pick('width', current.width), height: pick('height', current.height) },
  );
}

/**
 * Changes a figure. Alt, caption or asset → one undoable step that saves; display fields only
 * (`src`, `credit`, size) → a display transaction. `history: false` keeps a content change out
 * of ⌘Z (adopting a pasted image belongs to the paste).
 */
export function updateFigureTransaction(state: EditorState, blockId: BlockId, patch: FigurePatch, options: { history?: boolean } = {}): Transaction | null {
  const figure = findFigure(state.doc, blockId);
  if (!figure) return null;
  const next = patchedAttrs(figure, patch);
  const changed = (Object.keys(next) as (keyof FigureAttrs)[]).filter((name) => next[name] !== figure[name]);
  if (changed.length === 0) return null;
  const tr = state.tr;
  for (const name of changed) tr.setNodeAttribute(figure.pos, name, next[name]);
  if (changed.every((name) => (FIGURE_DISPLAY_ATTRS as readonly string[]).includes(name))) return displayOnly(tr);
  if (options.history === false) return tr.setMeta('addToHistory', false);
  return closeHistory(tr);
}

/** Removes a figure as one undoable step (an article left without blocks keeps an empty line). */
export function removeFigureTransaction(state: EditorState, blockId: BlockId): Transaction | null {
  const figure = findFigure(state.doc, blockId);
  if (!figure) return null;
  const tr = closeHistory(state.tr);
  if (state.doc.childCount === 1) tr.replaceWith(0, state.doc.content.size, state.schema.nodes[NODE.paragraph].create());
  else tr.delete(figure.pos, figure.pos + 1);
  if (figureAt(state.selection)?.blockId === blockId) {
    // The caret goes to the text around the image, never onto the next image.
    const $pos = tr.doc.resolve(Math.min(figure.pos, tr.doc.content.size));
    const next = Selection.findFrom($pos, 1, true) ?? Selection.findFrom($pos, -1, true);
    if (next) tr.setSelection(next);
  }
  return tr;
}

/** Applies display data to every figure whose asset has some; returns whether anything changed. */
function applySources(tr: Transaction, sources: FigureSources): boolean {
  let changed = false;
  tr.doc.forEach((node, pos) => {
    if (!isFigureNode(node)) return;
    const assetId = node.attrs[FIGURE_ATTR.assetId];
    const display = typeof assetId === 'string' ? sources.get(assetId) : undefined;
    if (!display) return;
    const target = figureAttrs({}, display);
    for (const name of FIGURE_DISPLAY_ATTRS) {
      if (node.attrs[name] === target[name]) continue;
      tr.setNodeAttribute(pos, name, target[name]);
      changed = true;
    }
  });
  return changed;
}

export const figureSourcesKey = new PluginKey<FigureSources>('reporterFigureSources');

/**
 * Display data for the figures (object URL of the stored file or the link, credit, size), per
 * asset. Replaces the previous map; a figure whose asset is not in it keeps what it shows.
 * A display transaction: nothing for ⌘Z, the autosave or the stream to see.
 */
export function setFigureSourcesTransaction(state: EditorState, sources: FigureSources): Transaction {
  const tr = state.tr.setMeta(figureSourcesKey, sources);
  applySources(tr, sources);
  return displayOnly(tr);
}

/** Keeps every figure in line with the latest display data (undo, paste, restore, rebuilt blocks). */
export function figureSourcesPlugin(): Plugin<FigureSources> {
  return new Plugin<FigureSources>({
    key: figureSourcesKey,
    state: {
      init: () => EMPTY_FIGURE_SOURCES,
      apply: (tr, previous) => (tr.getMeta(figureSourcesKey) as FigureSources | undefined) ?? previous,
    },
    appendTransaction(transactions, _oldState, state) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const sources = figureSourcesKey.getState(state) ?? EMPTY_FIGURE_SOURCES;
      if (sources.size === 0) return null;
      const tr = state.tr;
      return applySources(tr, sources) ? displayOnly(tr) : null;
    },
  });
}

export function figureSourcesOf(state: EditorState): FigureSources {
  return figureSourcesKey.getState(state) ?? EMPTY_FIGURE_SOURCES;
}

export function sameImageRef(a: ImageRef | null | undefined, b: ImageRef | null | undefined): boolean {
  return a?.assetId === b?.assetId && a?.alt === b?.alt && a?.caption === b?.caption;
}

/** Sets (or, with `null`, removes) the cover as one undoable step that saves; `null` when unchanged. */
export function setCoverTransaction(state: EditorState, cover: ImageRef | null): Transaction | null {
  const next = cover ? readImageRef(cover) : null;
  if (sameImageRef(coverOf(state.doc), next) || !(DOC_ATTR.cover in state.doc.attrs)) return null;
  return closeHistory(state.tr).setDocAttribute(DOC_ATTR.cover, next);
}

// ——— Anchors ———

export type FigureDOMView = {
  state: EditorState;
  nodeDOM: (pos: number) => unknown;
  isDestroyed?: boolean;
};

/** Anchor for the floating image toolbar: the figure's rectangle, or `null` when it is gone. */
export function figureRect(view: FigureDOMView, blockId: BlockId): DOMRect | null {
  if (view.isDestroyed) return null;
  const figure = findFigure(view.state.doc, blockId);
  if (!figure) return null;
  const dom = view.nodeDOM(figure.pos) as { getBoundingClientRect?: () => DOMRect } | null;
  return dom && typeof dom.getBoundingClientRect === 'function' ? dom.getBoundingClientRect() : null;
}
