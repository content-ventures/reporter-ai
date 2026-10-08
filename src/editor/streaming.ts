import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { AddMarkStep, RemoveMarkStep } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { articleBodyFromRun, isRunActive } from '../domain/index.ts';
import type { ArticleBlock, BlockId, RunEvent, RunFold, RunId, StreamBlock } from '../domain/index.ts';
import { isFigureDisplayTransaction } from './figures.ts';
import { blockNode } from './nodes.ts';
import { blockIdOf, blockTextOf, findBlockEntry, inlineText } from './ranges.ts';
import type { BlockEntry } from './ranges.ts';
import { BLOCK_ATTR, NODE } from './schema.ts';
import type { ViewLike } from './view.ts';

/**
 * Generation streaming into the document.
 *
 * - Streamed text enters with `addToHistory: false` (⌘Z never erases AI text) and
 *   `preventUpdate: true` (the run, not the autosave, owns generated content).
 * - On `block.completed` the streamed block is replaced by the final block, so the draft equals
 *   "v1 · IA" exactly (hash included) when the person did not edit.
 * - Blocks still being written are read-only: `filterTransaction` drops any change touching
 *   them and a node decoration sets `contenteditable="false"` + `aria-busy`. Finished blocks are
 *   editable at once. Selections elsewhere are only mapped, never moved or scrolled.
 * - The listener hands every `RunUpdate`; sync reads the folded state, so a late or batched
 *   update resynchronises instead of drifting.
 */

export type StreamMode = 'append' | 'replace';

export type StreamState = {
  runId: RunId | null;
  mode: StreamMode;
  /** Blocks being written now (read-only). */
  inFlight: readonly BlockId[];
  /** Blocks this stream wrote (inserted or took over). */
  owned: readonly BlockId[];
  /** The person changed the document while the stream was active. */
  edited: boolean;
};

export type StreamMeta = {
  type: 'begin' | 'sync' | 'end';
  runId: RunId | null;
  mode: StreamMode;
  inFlight: BlockId[];
  owned: BlockId[];
};

export const streamKey = new PluginKey<StreamState>('reporterStream');

export const IDLE_STREAM: StreamState = { runId: null, mode: 'append', inFlight: [], owned: [], edited: false };

/** Run kinds whose blocks stream into the article (sections mirror their events to the parent). */
const STREAMING_KINDS = new Set(['article.generate', 'article.section']);

export function streamState(state: EditorState): StreamState {
  return streamKey.getState(state) ?? IDLE_STREAM;
}

export function isStreaming(state: EditorState): boolean {
  return streamState(state).runId !== null;
}

/** True for stream transactions and for what other plugins append to them. */
export function isStreamTransaction(tr: Transaction): boolean {
  const root = tr.getMeta('appendedTransaction') as Transaction | undefined;
  return Boolean(tr.getMeta(streamKey) || root?.getMeta(streamKey));
}

function blockRanges(doc: PMNode, ids: ReadonlySet<BlockId>): [number, number][] {
  const ranges: [number, number][] = [];
  doc.forEach((node, pos) => {
    const id = blockIdOf(node);
    if (id && ids.has(id)) ranges.push([pos, pos + node.nodeSize]);
  });
  return ranges;
}

/** Whether any step of `tr` replaces or re-marks content inside the given blocks. */
export function touchesBlocks(tr: Transaction, doc: PMNode, ids: readonly BlockId[]): boolean {
  let ranges = blockRanges(doc, new Set(ids));
  if (ranges.length === 0) return false;
  for (const [index, step] of tr.steps.entries()) {
    const map = tr.mapping.maps[index];
    let hit = false;
    map.forEach((oldStart, oldEnd) => {
      if (ranges.some(([from, to]) => oldStart < to && oldEnd > from)) hit = true;
    });
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
      const { from, to } = step;
      if (ranges.some(([start, end]) => from < end - 1 && to > start + 1)) hit = true;
    }
    if (hit) return true;
    ranges = ranges.map(([from, to]) => [map.map(from, 1), map.map(to, -1)]);
  }
  return false;
}

function streamingDecorations(state: EditorState): DecorationSet {
  const { inFlight } = streamState(state);
  if (inFlight.length === 0) return DecorationSet.empty;
  const decorations = blockRanges(state.doc, new Set(inFlight)).map(([from, to]) =>
    Decoration.node(from, to, { contenteditable: 'false', 'aria-busy': 'true' }),
  );
  return DecorationSet.create(state.doc, decorations);
}

export function streamPlugin(): Plugin<StreamState> {
  return new Plugin<StreamState>({
    key: streamKey,
    state: {
      init: () => IDLE_STREAM,
      apply(tr, previous) {
        const meta = tr.getMeta(streamKey) as StreamMeta | undefined;
        if (meta) {
          if (meta.type === 'end') return IDLE_STREAM;
          return {
            runId: meta.runId,
            mode: meta.mode,
            inFlight: meta.inFlight,
            owned: meta.owned,
            edited: meta.type === 'begin' ? false : previous.edited,
          };
        }
        // Display data synced into figures (image address, credit) is not an edit by the person.
        if (previous.runId && tr.docChanged && !previous.edited && !isStreamTransaction(tr) && !isFigureDisplayTransaction(tr)) {
          return { ...previous, edited: true };
        }
        return previous;
      },
    },
    filterTransaction(tr, state) {
      const current = streamState(state);
      if (current.inFlight.length === 0 || !tr.docChanged || isStreamTransaction(tr)) return true;
      return !touchesBlocks(tr, state.doc, current.inFlight);
    },
    props: {
      decorations: streamingDecorations,
    },
  });
}

// ——— Building stream transactions ———

/** The block as streamed so far: plain AI text, list items split on `\n`. */
export function streamedBlock(block: StreamBlock): ArticleBlock {
  const inlines = block.text ? [{ text: block.text }] : [];
  const base = { id: block.id, ai: 'unreviewed' as const };
  switch (block.type) {
    case 'heading':
      return { ...base, type: 'heading', level: block.level ?? 2, inlines };
    case 'quote':
      return { ...base, type: 'quote', inlines };
    case 'list':
      return { ...base, type: 'list', ordered: block.ordered ?? false, items: block.text.split('\n').map((text) => (text ? [{ text }] : [])) };
    case 'divider':
      return { id: block.id, type: 'divider' };
    default:
      return { ...base, type: 'paragraph', inlines };
  }
}

function textFragment(schema: Schema, text: string): Fragment {
  const nodes: PMNode[] = [];
  text.split('\n').forEach((segment, index) => {
    if (index > 0) nodes.push(schema.nodes[NODE.hardBreak].create());
    if (segment) nodes.push(schema.text(segment));
  });
  return Fragment.from(nodes);
}

function isBlankDoc(doc: PMNode): boolean {
  const first = doc.firstChild;
  return doc.childCount === 1 && first !== null && first.type.name === NODE.paragraph && first.content.size === 0;
}

function replaceNode(tr: Transaction, entry: BlockEntry, node: PMNode): void {
  if (!entry.node.eq(node)) tr.replaceWith(entry.pos, entry.pos + entry.node.nodeSize, node);
}

function removeBlock(tr: Transaction, entry: BlockEntry): void {
  if (tr.doc.childCount === 1) {
    tr.replaceWith(0, tr.doc.content.size, tr.doc.type.schema.nodes[NODE.paragraph].create());
    return;
  }
  tr.delete(entry.pos, entry.pos + entry.node.nodeSize);
}

function insertStreamBlock(tr: Transaction, fold: RunFold, index: number, node: PMNode): void {
  for (let previous = index - 1; previous >= 0; previous -= 1) {
    const entry = findBlockEntry(tr.doc, fold.blocks[previous].id);
    if (entry) {
      tr.insert(entry.pos + entry.node.nodeSize, node);
      return;
    }
  }
  for (let next = index + 1; next < fold.blocks.length; next += 1) {
    const entry = findBlockEntry(tr.doc, fold.blocks[next].id);
    if (entry) {
      tr.insert(entry.pos, node);
      return;
    }
  }
  if (isBlankDoc(tr.doc)) {
    tr.replaceWith(0, tr.doc.content.size, node);
    return;
  }
  // Keep the empty caret paragraph TipTap leaves at the end of the document last.
  const last = tr.doc.lastChild;
  const end = tr.doc.content.size;
  const trailing = last !== null && last.type.name === NODE.paragraph && last.content.size === 0;
  tr.insert(trailing && last ? end - last.nodeSize : end, node);
}

function updateStreamingNode(tr: Transaction, entry: BlockEntry, block: StreamBlock): void {
  const schema = tr.doc.type.schema;
  const next = blockNode(schema, streamedBlock(block));
  if (entry.node.eq(next)) return;
  const sameShell =
    entry.node.isTextblock &&
    entry.node.type === next.type &&
    entry.node.attrs.level === next.attrs.level &&
    entry.node.attrs[BLOCK_ATTR.ai] === next.attrs[BLOCK_ATTR.ai];
  if (sameShell) {
    const current = inlineText(entry.node);
    if (block.text.length > current.length && block.text.startsWith(current)) {
      tr.insert(entry.pos + 1 + entry.node.content.size, textFragment(schema, block.text.slice(current.length)));
      return;
    }
  }
  replaceNode(tr, entry, next);
}

type Ownership = { inFlight: Set<BlockId>; owned: Set<BlockId> };

function syncBlock(tr: Transaction, fold: RunFold, index: number, ownership: Ownership): void {
  const schema = tr.doc.type.schema;
  const block = fold.blocks[index];
  const final = block.complete ? block.final : undefined;
  const entry = findBlockEntry(tr.doc, block.id);

  if (!entry) {
    // A finished block this stream wrote and the person then deleted stays deleted.
    if (ownership.owned.has(block.id) && !ownership.inFlight.has(block.id)) return;
    insertStreamBlock(tr, fold, index, blockNode(schema, final ?? streamedBlock(block)));
    ownership.owned.add(block.id);
    if (!final) ownership.inFlight.add(block.id);
    else ownership.inFlight.delete(block.id);
    return;
  }

  if (!ownership.inFlight.has(block.id)) {
    // Take over a block only while it is being written and it holds nothing but streamed text
    // (attach after a remount). Finished blocks are the person's now: never overwritten.
    const text = blockTextOf(entry.node);
    const streamedSoFar = !final && block.text.startsWith(text) && (entry.node.attrs[BLOCK_ATTR.ai] === 'unreviewed' || text === '');
    if (!streamedSoFar || ownership.owned.has(block.id)) return;
    ownership.inFlight.add(block.id);
    ownership.owned.add(block.id);
  }

  if (final) {
    replaceNode(tr, entry, blockNode(schema, final));
    ownership.inFlight.delete(block.id);
    return;
  }
  updateStreamingNode(tr, entry, block);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function finish(tr: Transaction, meta: StreamMeta): Transaction {
  return tr.setMeta(streamKey, meta).setMeta('addToHistory', false).setMeta('preventUpdate', true);
}

export type StreamSyncOptions = {
  /** How a NEW run starts: `replace` clears the document at its first block ("Gerar nova versão"). */
  mode?: StreamMode;
  /** Only these blocks (plus any block missing from the document) are compared. */
  only?: readonly BlockId[];
};

/**
 * Brings the document in line with a run fold. Pure: returns the transaction (or `null` when
 * nothing changes) for the caller to dispatch.
 */
export function streamTransaction(state: EditorState, fold: RunFold, options: StreamSyncOptions = {}): Transaction | null {
  if (!STREAMING_KINDS.has(fold.run.kind)) return null;
  const current = streamState(state);
  const sameRun = current.runId === fold.run.id;
  if (!sameRun && fold.blocks.length === 0) return null;
  const mode = sameRun ? current.mode : (options.mode ?? 'append');
  const ownership: Ownership = { inFlight: new Set(sameRun ? current.inFlight : []), owned: new Set(sameRun ? current.owned : []) };
  const tr = state.tr;

  if (!sameRun && mode === 'replace') {
    tr.replaceWith(0, tr.doc.content.size, state.schema.nodes[NODE.paragraph].create());
  }
  // `only` narrows the work per event; blocks still in flight and blocks missing from the
  // document are always compared, so a coalesced or missed event never leaves a block behind.
  const only = options.only && sameRun ? new Set(options.only) : null;
  fold.blocks.forEach((block, index) => {
    if (only && !only.has(block.id) && !ownership.inFlight.has(block.id) && findBlockEntry(tr.doc, block.id)) return;
    syncBlock(tr, fold, index, ownership);
  });

  const meta: StreamMeta = {
    type: sameRun ? 'sync' : 'begin',
    runId: fold.run.id,
    mode,
    inFlight: [...ownership.inFlight],
    owned: [...ownership.owned],
  };
  if (sameRun && !tr.docChanged && sameList(meta.inFlight, current.inFlight) && sameList(meta.owned, current.owned)) return null;
  return finish(tr, meta);
}

/**
 * Settles the stream when the run ends: finished blocks become final, an interrupted run keeps
 * its partial text cut at a word boundary (exactly "v1 · interrompida"), and a failed run drops
 * the unfinished block (finished sections stay). Ends read-only mode.
 */
export function endStreamTransaction(state: EditorState, fold: RunFold): Transaction | null {
  const current = streamState(state);
  if (current.runId === null || current.runId !== fold.run.id) return null;
  const ownership: Ownership = { inFlight: new Set(current.inFlight), owned: new Set(current.owned) };
  const tr = state.tr;
  fold.blocks.forEach((_block, index) => syncBlock(tr, fold, index, ownership));

  const partial = fold.run.status === 'cancelled' ? articleBodyFromRun(fold, { includePartial: true }).blocks : [];
  for (const id of ownership.inFlight) {
    const entry = findBlockEntry(tr.doc, id);
    if (!entry) continue;
    const kept = partial.find((block) => block.id === id);
    if (kept) replaceNode(tr, entry, blockNode(state.schema, kept));
    else removeBlock(tr, entry);
  }
  return finish(tr, { type: 'end', runId: null, mode: 'append', inFlight: [], owned: [] });
}

export type RunUpdateLike = { event: RunEvent; fold: RunFold };

/**
 * Feeds one `RunUpdate` (from `useRunListener`) into the editor. Returns whether the document
 * or the stream state changed.
 */
export function applyRunUpdateToEditor(view: ViewLike, update: RunUpdateLike, options: Pick<StreamSyncOptions, 'mode'> = {}): boolean {
  const { event, fold } = update;
  let tr: Transaction | null;
  switch (event.type) {
    case 'run.completed':
    case 'run.failed':
    case 'run.cancelled':
      tr = endStreamTransaction(view.state, fold);
      break;
    case 'block.started':
      tr = streamTransaction(view.state, fold, { ...options, only: [event.block.id] });
      break;
    case 'block.completed':
      tr = streamTransaction(view.state, fold, { ...options, only: [event.block.id] });
      break;
    case 'text.delta':
      tr = streamTransaction(view.state, fold, { ...options, only: [event.blockId] });
      break;
    default:
      tr = streamTransaction(view.state, fold, options);
  }
  if (!tr) return false;
  view.dispatch(tr);
  return true;
}

/**
 * Feeds the snapshot `useRun` returns on attach (the listener only sees later updates). A live
 * run is brought in line (blocks known so far inserted, the open one taken over); a finished
 * run only settles a stream this editor was showing: the draft already holds its output, so
 * nothing the person deleted comes back. `mode: 'replace'` only applies to a run this screen
 * just started.
 */
export function syncRunSnapshotInEditor(view: ViewLike, fold: RunFold, options: Pick<StreamSyncOptions, 'mode'> = {}): boolean {
  let tr: Transaction | null = null;
  if (isRunActive(fold.run)) tr = streamTransaction(view.state, fold, options);
  else if (streamState(view.state).runId === fold.run.id) tr = endStreamTransaction(view.state, fold);
  if (!tr) return false;
  view.dispatch(tr);
  return true;
}

/**
 * Writes a whole finished run into a document that does not hold it yet (tests, a body loaded
 * before the run). Missing blocks are inserted: never use it on a draft that already settled.
 */
export function settleRunInEditor(view: ViewLike, fold: RunFold, options: Pick<StreamSyncOptions, 'mode'> = {}): boolean {
  const begun = streamTransaction(view.state, fold, options);
  if (begun) view.dispatch(begun);
  const ended = endStreamTransaction(view.state, fold);
  if (ended) view.dispatch(ended);
  return Boolean(begun || ended);
}

export function streamingBlockIds(state: EditorState): readonly BlockId[] {
  return streamState(state).inFlight;
}
