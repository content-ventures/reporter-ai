import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Mapping } from '@tiptap/pm/transform';
import type { Mappable } from '@tiptap/pm/transform';
import type { BlockId } from '../domain/index.ts';
import { blockIdOf, blockTextOf } from './ranges.ts';
import { BLOCK_ATTR } from './schema.ts';

/**
 * Stable block ids. Every top-level block carries `blockId`; new blocks get one, a split keeps
 * the id on the half that still reads like the original, and a pasted or duplicated id is
 * reassigned on the copy. Nodes nested in a list never keep block attributes: wrapping a
 * paragraph in a list moves its id, review state and source refs to the list. A restyle that
 * resets attributes (Estilo ▾, which runs `clearNodes`) or a lifted list keeps the identity.
 */

export type BlockIdFactory = () => BlockId;

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomSalt(length: number): string {
  const bytes = new Uint8Array(length);
  const crypto = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let index = 0; index < length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join('');
}

/**
 * `blk-a1b2c3-1`, `blk-a1b2c3-2`…: a per-editor salt plus a counter. Never `crypto.randomUUID`
 * (missing over plain http); the 6-character salt never matches the runtime's 5-character one.
 */
export function createBlockIdFactory(options: { prefix?: string; salt?: string } = {}): BlockIdFactory {
  const prefix = options.prefix ?? 'blk';
  const salt = options.salt ?? randomSalt(6);
  let counter = 0;
  return () => {
    counter += 1;
    return `${prefix}-${salt}-${counter.toString(36)}`;
  };
}

export type BlockAttrFix = { pos: number; attrs: Record<string, unknown> };

/**
 * The document before the change: `mapping` maps old → new positions, `back` (optional) new →
 * old. With `back`, a block whose attributes a command reset (TipTap `clearNodes`,
 * `setNodeMarkup`, lifting a list) gets the identity of the block it came from back.
 */
export type PreviousDoc = { doc: PMNode; mapping: Mappable; back?: Mappable };

const BLOCK_ATTR_NAMES = [BLOCK_ATTR.id, BLOCK_ATTR.sourceRefs, BLOCK_ATTR.ai] as const;

function hasBlockAttrs(node: PMNode): boolean {
  return BLOCK_ATTR.id in node.attrs;
}

function carriesBlockAttrs(node: PMNode): boolean {
  return hasBlockAttrs(node) && BLOCK_ATTR_NAMES.some((name) => node.attrs[name] !== null && node.attrs[name] !== undefined);
}

type Candidate = { node: PMNode; pos: number };

/** The top-level block of the previous document a new block came from (through `back`). */
function originBlock(candidate: Candidate, previous: PreviousDoc | undefined): PMNode | undefined {
  if (!previous?.back) return undefined;
  const pos = previous.back.map(candidate.pos, 1);
  if (pos < 0 || pos >= previous.doc.content.size) return undefined;
  const $pos = previous.doc.resolve(pos);
  const node = $pos.depth >= 1 ? $pos.node(1) : $pos.nodeAfter;
  return node && hasBlockAttrs(node) ? node : undefined;
}

function keeperIndex(candidates: readonly Candidate[], id: BlockId, previous: PreviousDoc | undefined): number {
  let original: { node: PMNode; pos: number } | undefined;
  previous?.doc.forEach((node, pos) => {
    if (!original && blockIdOf(node) === id) original = { node, pos };
  });
  const oldText = original ? blockTextOf(original.node) : undefined;
  const mapped = original && previous ? previous.mapping.map(original.pos, 1) : undefined;
  let best = 0;
  let bestScore = -1;
  candidates.forEach((candidate, index) => {
    const text = blockTextOf(candidate.node);
    let score = text ? 1 : 0;
    if (oldText !== undefined && text && oldText.startsWith(text)) score = 2;
    if (oldText !== undefined && text === oldText) score = 3;
    score = score * 2 + (candidate.pos === mapped ? 1 : 0);
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return best;
}

/**
 * Attribute fixes that make every top-level id present and unique and clear block attributes
 * from nested nodes. Pure: `previous` (the doc before the change and the mapping) only decides
 * which duplicate keeps the id.
 */
export function blockIdFixes(doc: PMNode, options: { newId: BlockIdFactory; previous?: PreviousDoc }): BlockAttrFix[] {
  const fixes = new Map<number, Record<string, unknown>>();
  const fix = (pos: number, attrs: Record<string, unknown>) => fixes.set(pos, { ...fixes.get(pos), ...attrs });
  const top: Candidate[] = [];
  const nested: Candidate[] = [];

  doc.forEach((node, pos) => {
    top.push({ node, pos });
    if (node.isTextblock || node.isLeaf) return;
    node.descendants((child, childPos) => {
      if (carriesBlockAttrs(child)) nested.push({ node: child, pos: pos + 1 + childPos });
      return !child.isTextblock;
    });
  });

  const taken = new Set<BlockId>();
  for (const { node } of top) {
    const id = blockIdOf(node);
    if (id) taken.add(id);
  }
  const fresh = () => {
    let id = options.newId();
    while (taken.has(id)) id = options.newId();
    taken.add(id);
    return id;
  };

  // A block without id, in order:
  // 1. a wrapper (list) adopts the identity of the first block it wraps that no top-level block uses;
  // 2. a block whose attributes a command reset (restyle, lift) takes back the identity of the
  //    block it came from, when that identity left the top level. Provenance (AI state, source
  //    refs) follows when the text is part of the original's text: a restyled paragraph or a
  //    lifted list item keeps it, text pasted over a deleted block does not;
  // 3. anything else is a new block.
  const adopted = new Set<PMNode>();
  const claimed = new Map<BlockId, BlockId>();
  for (const candidate of top) {
    if (!hasBlockAttrs(candidate.node) || blockIdOf(candidate.node)) continue;
    const end = candidate.pos + candidate.node.nodeSize;
    const donor = nested.find((entry) => {
      const id = blockIdOf(entry.node);
      return entry.pos > candidate.pos && entry.pos < end && id !== null && !taken.has(id) && !adopted.has(entry.node);
    });
    if (donor) {
      adopted.add(donor.node);
      const id = blockIdOf(donor.node) as BlockId;
      taken.add(id);
      fix(candidate.pos, {
        [BLOCK_ATTR.id]: id,
        [BLOCK_ATTR.sourceRefs]: donor.node.attrs[BLOCK_ATTR.sourceRefs] ?? null,
        [BLOCK_ATTR.ai]: donor.node.attrs[BLOCK_ATTR.ai] ?? null,
      });
      continue;
    }
    const origin = originBlock(candidate, options.previous);
    const originId = origin ? blockIdOf(origin) : null;
    const vanished = originId !== null && (!taken.has(originId) || claimed.has(originId));
    if (!origin || !originId || !vanished) {
      fix(candidate.pos, { [BLOCK_ATTR.id]: fresh() });
      continue;
    }
    const id = claimed.has(originId) ? fresh() : originId;
    taken.add(id);
    claimed.set(originId, id);
    const text = blockTextOf(candidate.node);
    const provenance = text !== '' && blockTextOf(origin).includes(text);
    fix(candidate.pos, {
      [BLOCK_ATTR.id]: id,
      ...(provenance
        ? { [BLOCK_ATTR.sourceRefs]: origin.attrs[BLOCK_ATTR.sourceRefs] ?? null, [BLOCK_ATTR.ai]: origin.attrs[BLOCK_ATTR.ai] ?? null }
        : {}),
    });
  }

  for (const entry of nested) {
    fix(entry.pos, { [BLOCK_ATTR.id]: null, [BLOCK_ATTR.sourceRefs]: null, [BLOCK_ATTR.ai]: null });
  }

  const groups = new Map<BlockId, Candidate[]>();
  for (const candidate of top) {
    const id = blockIdOf(candidate.node);
    if (!id) continue;
    groups.set(id, [...(groups.get(id) ?? []), candidate]);
  }
  for (const [id, candidates] of groups) {
    if (candidates.length < 2) continue;
    const keep = keeperIndex(candidates, id, options.previous);
    candidates.forEach((candidate, index) => {
      if (index === keep) return;
      const empty = candidate.node.content.size === 0 || !blockTextOf(candidate.node);
      fix(candidate.pos, {
        [BLOCK_ATTR.id]: fresh(),
        // An empty copy (Enter at the start of a block) is a new block, not AI text with sources.
        ...(empty ? { [BLOCK_ATTR.sourceRefs]: null, [BLOCK_ATTR.ai]: null } : {}),
      });
    });
  }

  return [...fixes].map(([pos, attrs]) => ({ pos, attrs }));
}

/** Applies fixes as attribute steps only (no position changes, nothing for other plugins to map). */
export function applyBlockAttrFixes(tr: Transaction, fixes: readonly BlockAttrFix[]): Transaction {
  for (const { pos, attrs } of fixes) {
    const node = tr.doc.nodeAt(pos);
    if (!node) continue;
    for (const [name, value] of Object.entries(attrs)) {
      if (name in node.attrs && node.attrs[name] !== value) tr.setNodeAttribute(pos, name, value);
    }
  }
  return tr;
}

export const blockIdsKey = new PluginKey('reporterBlockIds');

/** Assigns and dedupes ids after every document change (appended to the same undo step). */
export function blockIdsPlugin(options: { newId: BlockIdFactory }): Plugin {
  return new Plugin({
    key: blockIdsKey,
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const mapping = new Mapping();
      for (const tr of transactions) mapping.appendMapping(tr.mapping);
      const fixes = blockIdFixes(newState.doc, { newId: options.newId, previous: { doc: oldState.doc, mapping, back: mapping.invert() } });
      if (fixes.length === 0) return null;
      const tr = applyBlockAttrFixes(newState.tr, fixes);
      return tr.docChanged ? tr : null;
    },
  });
}

/** For a document loaded without ids: one transaction outside the undo history, or `null`. */
export function ensureBlockIds(state: EditorState, newId: BlockIdFactory): Transaction | null {
  const fixes = blockIdFixes(state.doc, { newId });
  if (fixes.length === 0) return null;
  const tr = applyBlockAttrFixes(state.tr, fixes);
  if (!tr.docChanged) return null;
  return tr.setMeta('addToHistory', false).setMeta('preventUpdate', true);
}
