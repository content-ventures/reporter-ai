import type { Node as PMNode } from '@tiptap/pm/model';
import type { BlockId, TextRange } from '../domain/index.ts';
import { BLOCK_ATTR, NODE } from './schema.ts';

/**
 * Domain text ranges (`{blockId, from, to}`, offsets in `blockText`) ⇄ ProseMirror positions.
 * Offsets are 1:1 with positions inside a textblock: a hard break is one character (`\n`).
 * In a list, item texts are joined with `\n` exactly like the domain `blockText`.
 */

export type BlockEntry = {
  node: PMNode;
  /** Position before the block node. */
  pos: number;
  /** Index among the document's top-level blocks (0-based). */
  index: number;
  id: BlockId | null;
};

/** A textblock inside a block: where its content starts and its text. */
export type BlockLine = { start: number; size: number; text: string };

export type BlockOffset = { blockId: BlockId; index: number; offset: number };

export function blockIdOf(node: PMNode): BlockId | null {
  const id = node.attrs[BLOCK_ATTR.id];
  return typeof id === 'string' && id ? id : null;
}

export function blockEntries(doc: PMNode): BlockEntry[] {
  const entries: BlockEntry[] = [];
  doc.forEach((node, offset, index) => {
    entries.push({ node, pos: offset, index, id: blockIdOf(node) });
  });
  return entries;
}

export function findBlockEntry(doc: PMNode, blockId: BlockId): BlockEntry | undefined {
  let found: BlockEntry | undefined;
  doc.forEach((node, offset, index) => {
    if (!found && blockIdOf(node) === blockId) found = { node, pos: offset, index, id: blockId };
  });
  return found;
}

/** Text of a textblock's inline content: text as is, a hard break as `\n`, any other leaf as U+FFFC. */
export function inlineText(textblock: PMNode): string {
  let text = '';
  textblock.forEach((child) => {
    if (child.isText) text += child.text ?? '';
    else text += child.type.name === NODE.hardBreak ? '\n' : '￼';
  });
  return text;
}

/** The textblocks of a top-level block, in order (the block itself when it is a textblock). */
export function blockLines(node: PMNode, pos: number): BlockLine[] {
  if (node.isTextblock) return [{ start: pos + 1, size: node.content.size, text: inlineText(node) }];
  const lines: BlockLine[] = [];
  node.descendants((child, childPos) => {
    if (!child.isTextblock) return true;
    lines.push({ start: pos + 1 + childPos + 1, size: child.content.size, text: inlineText(child) });
    return false;
  });
  return lines;
}

/** Plain text of a top-level block, identical to the domain `blockText` of its converted block. */
export function blockTextOf(node: PMNode): string {
  return blockLines(node, 0)
    .map((line) => line.text)
    .join('\n');
}

/** Offset inside a block's text → document position (clamped to the block). */
export function offsetToPos(entry: Pick<BlockEntry, 'node' | 'pos'>, offset: number): number {
  const lines = blockLines(entry.node, entry.pos);
  if (lines.length === 0) return entry.pos;
  let start = 0;
  for (const [index, line] of lines.entries()) {
    const end = start + line.size;
    if (offset <= end || index === lines.length - 1) return line.start + Math.max(0, Math.min(offset - start, line.size));
    start = end + 1;
  }
  return entry.pos;
}

/** Document position inside a block → offset in the block's text. */
export function posToOffset(entry: Pick<BlockEntry, 'node' | 'pos'>, pos: number): number {
  const lines = blockLines(entry.node, entry.pos);
  let start = 0;
  let offset = 0;
  for (const line of lines) {
    if (pos < line.start) return offset;
    if (pos <= line.start + line.size) return start + (pos - line.start);
    start += line.size + 1;
    offset = start - 1;
  }
  return Math.max(0, offset);
}

/** `{blockId, from, to}` → positions; `undefined` when the block is gone or offsets overflow. */
export function textRangeToPositions(doc: PMNode, range: TextRange): { from: number; to: number } | undefined {
  const entry = findBlockEntry(doc, range.blockId);
  if (!entry) return undefined;
  const length = blockTextOf(entry.node).length;
  if (range.from < 0 || range.from > range.to || range.to > length) return undefined;
  return { from: offsetToPos(entry, range.from), to: offsetToPos(entry, range.to) };
}

/** Position → the top-level block containing it and the offset there. */
export function posToBlockOffset(doc: PMNode, pos: number): BlockOffset | undefined {
  if (pos < 0 || pos > doc.content.size) return undefined;
  // Inside a block first; on a boundary, the block that starts there (a selected divider), then
  // the one that ends there.
  let inside: BlockEntry | undefined;
  let starting: BlockEntry | undefined;
  let ending: BlockEntry | undefined;
  doc.forEach((node, blockPos, index) => {
    const entry = { node, pos: blockPos, index, id: blockIdOf(node) };
    const end = blockPos + node.nodeSize;
    if (pos > blockPos && pos < end) inside ??= entry;
    else if (pos === blockPos) starting ??= entry;
    else if (pos === end) ending ??= entry;
  });
  const entry = inside ?? starting ?? ending;
  if (!entry?.id) return undefined;
  return { blockId: entry.id, index: entry.index, offset: posToOffset(entry, pos) };
}

/** A position range → one domain range per top-level block it touches (dividers and figures skipped). */
export function positionsToTextRanges(doc: PMNode, from: number, to: number): TextRange[] {
  const start = Math.max(0, Math.min(from, to));
  const end = Math.min(doc.content.size, Math.max(from, to));
  const collapsed = start === end;
  const ranges: TextRange[] = [];
  doc.forEach((node, pos) => {
    const nodeEnd = pos + node.nodeSize;
    const touches = collapsed ? pos < start && start < nodeEnd : pos < end && nodeEnd > start;
    const id = blockIdOf(node);
    if (!touches || !id || node.type.name === NODE.divider || node.type.name === NODE.figure) return;
    const entry = { node, pos };
    const range = { blockId: id, from: posToOffset(entry, Math.max(start, pos)), to: posToOffset(entry, Math.min(end, nodeEnd)) };
    // A selection that merely reaches the edge of a block (triple click) does not select it.
    if (collapsed || range.from < range.to) ranges.push(range);
  });
  return ranges;
}
