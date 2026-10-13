import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState, Selection } from '@tiptap/pm/state';
import type { BlockId, TextRange } from '../domain/index.ts';
import { figureAt } from './figures.ts';
import { blockIdOf, findBlockEntry, positionsToTextRanges, textRangeToPositions } from './ranges.ts';
import { NODE } from './schema.ts';

/**
 * Selection facts for the floating toolbar and the copilot context chip ("Seleção · §3"), and
 * the rectangle the `FloatingToolbar` anchors to. Reading only: nothing here touches the DOM
 * beyond `coordsAtPos`/`posAtCoords`.
 */

export type SelectionInfo = {
  /** No text selected: a caret, or only an image or a rule (see `figureId`). */
  empty: boolean;
  from: number;
  to: number;
  /** One domain range per block touched (dividers skipped). */
  ranges: TextRange[];
  blockIds: BlockId[];
  /** 1-based positions of those blocks in the article (the "§" numbers). */
  blockNumbers: number[];
  /** Selected text, blocks separated by a blank line. */
  text: string;
  /** "§3", "§3–5"; `null` with nothing selected. */
  label: string | null;
  /** A selected image (the image toolbar shows instead of the text one); `null` otherwise. */
  figureId: BlockId | null;
};

export const EMPTY_SELECTION_INFO: SelectionInfo = {
  empty: true,
  from: 0,
  to: 0,
  ranges: [],
  blockIds: [],
  blockNumbers: [],
  text: '',
  label: null,
  figureId: null,
};

/** "§3" for one block, "§3–5" for a run, "§2, §5" otherwise. */
export function sectionLabel(numbers: readonly number[]): string | null {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return `§${sorted[0]}`;
  const contiguous = sorted.every((value, index) => index === 0 || value === sorted[index - 1] + 1);
  return contiguous ? `§${sorted[0]}–${sorted[sorted.length - 1]}` : sorted.map((value) => `§${value}`).join(', ');
}

function leafText(node: PMNode): string {
  return node.type.name === NODE.hardBreak ? '\n' : '';
}

/**
 * Where the caret goes once a decision replaced the selected text (the end of it), or `null`
 * when nothing should move: a caret already, or a selected image or rule, whose end lies between
 * blocks where no caret can stand.
 */
export function caretAfterSelection(selection: Selection): number | null {
  return !selection.empty && selection.$to.parent.inlineContent ? selection.to : null;
}

export function selectionInfo(state: EditorState): SelectionInfo {
  const { from, to } = state.selection;
  const ranges = positionsToTextRanges(state.doc, from, to);
  // A selected image or rule holds no text: the text toolbar and the "Seleção" chip stay closed.
  const empty = state.selection.empty || ranges.length === 0;
  const blockIds = ranges.map((range) => range.blockId);
  const blockNumbers = blockIds.map((id) => (findBlockEntry(state.doc, id)?.index ?? -1) + 1).filter((value) => value > 0);
  return {
    empty,
    from,
    to,
    ranges,
    blockIds,
    blockNumbers,
    text: empty ? '' : state.doc.textBetween(from, to, '\n\n', leafText),
    label: empty ? null : sectionLabel(blockNumbers),
    figureId: figureAt(state.selection)?.blockId ?? null,
  };
}

// ——— Rectangles ———

export type Coords = { left: number; right: number; top: number; bottom: number };

export type RectInit = { x: number; y: number; width: number; height: number };

/** Union of the caret boxes at both ends of a range. */
export function unionCoords(start: Coords, end: Coords): RectInit {
  const left = Math.min(start.left, end.left);
  const right = Math.max(start.right, end.right);
  const top = Math.min(start.top, end.top);
  const bottom = Math.max(start.bottom, end.bottom);
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export type CoordsView = {
  state: EditorState;
  coordsAtPos: (pos: number, side?: number) => Coords;
  isDestroyed?: boolean;
};

function toDOMRect(init: RectInit): DOMRect {
  return new DOMRect(init.x, init.y, init.width, init.height);
}

/** Rectangle of a document range in the window, or `null` when the view is not usable. */
export function rangeRect(view: CoordsView, from: number, to: number, makeRect: (init: RectInit) => DOMRect = toDOMRect): DOMRect | null {
  if (view.isDestroyed) return null;
  const size = view.state.doc.content.size;
  const start = Math.max(0, Math.min(from, size));
  const end = Math.max(0, Math.min(to, size));
  try {
    return makeRect(unionCoords(view.coordsAtPos(start, 1), view.coordsAtPos(end, -1)));
  } catch {
    return null;
  }
}

/** Anchor for `FloatingToolbar`: the selected text, `null` for an empty selection. */
export function selectionRect(view: CoordsView, makeRect?: (init: RectInit) => DOMRect): DOMRect | null {
  const { from, to, empty } = view.state.selection;
  if (empty) return null;
  return rangeRect(view, from, to, makeRect);
}

/** Anchor for a source preview or block menu: the whole block. */
export function blockRect(view: CoordsView, blockId: BlockId, makeRect?: (init: RectInit) => DOMRect): DOMRect | null {
  const entry = findBlockEntry(view.state.doc, blockId);
  if (!entry) return null;
  return rangeRect(view, entry.pos + 1, entry.pos + entry.node.nodeSize - 1, makeRect);
}

/** Anchor for a domain range (suggestion target, quote). */
export function textRangeRect(view: CoordsView, range: TextRange, makeRect?: (init: RectInit) => DOMRect): DOMRect | null {
  const positions = textRangeToPositions(view.state.doc, range);
  if (!positions) return null;
  return rangeRect(view, positions.from, positions.to, makeRect);
}

export type PointView = {
  state: EditorState;
  posAtCoords: (coords: { left: number; top: number }) => { pos: number; inside: number } | null;
  isDestroyed?: boolean;
};

/** The block under a pointer (hover a paragraph → light its source excerpt). */
export function blockIdAtPoint(view: PointView, x: number, y: number): BlockId | null {
  if (view.isDestroyed) return null;
  let found: { pos: number; inside: number } | null = null;
  try {
    found = view.posAtCoords({ left: x, top: y });
  } catch {
    return null;
  }
  if (!found) return null;
  const pos = found.inside >= 0 ? found.inside : found.pos;
  let id: BlockId | null = null;
  view.state.doc.forEach((node, offset) => {
    if (id === null && pos >= offset && pos < offset + node.nodeSize) id = blockIdOf(node);
  });
  return id;
}
