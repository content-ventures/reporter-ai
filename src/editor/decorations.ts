import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { BlockId, TextRange } from '../domain/index.ts';
import { blockIdOf, blockTextOf, findBlockEntry, offsetToPos, textRangeToPositions } from './ranges.ts';
import { BLOCK_ATTR, DATA_ATTR, NODE } from './schema.ts';
import { streamKey } from './streaming.ts';
import type { StreamMeta } from './streaming.ts';
import type { ViewLike } from './view.ts';

/**
 * Decorations read by the Design System `Prose` hooks. Nothing here creates DOM: `Decoration.node`
 * adds attributes to a block, `Decoration.inline` wraps a range in a span that only carries
 * `data-*` attributes, and the two widgets (the proposal read in the paragraph, the AI marker in
 * the gutter) come from the Design System factory (`proseWidgets`) the client hands in.
 *
 * - `data-ai="unreviewed"` (+ `aria-description`): derived from the `ai` attr of each block, with
 *   the factory's gutter marker ("Revisar texto da IA") at the start of the block. While a
 *   generation writes, only the block being written is marked (`data-ai="writing"`).
 * - `data-source-active`: blocks linked to the transcript segment lit right now.
 * - `data-suggestion="delete"` (+ `data-stale`): what pending suggestions take out, followed by
 *   the factory's insertion with what they put in.
 * - `data-stale`: ranges that lost their anchor (edited target, corrected source).
 * - `data-source-state="used|missing"`: quotations checked against the material.
 * - `pointed`: passages a reviewer pointed at in "Devolver com nota", wrapped in `<mark
 *   data-pointed>` (the Prose highlighter: a person's mark, never a status tone). ProseMirror
 *   renders the wrapper from the decoration spec; nothing here creates DOM.
 * - `data-bar-space="below"`: the block a floating bar (suggestion, quotation) decides about; Prose
 *   opens the bar's room under it, so the bar never covers the next line.
 *
 * React sets the inputs through transaction meta (`setArticleDecorations`); text ranges are
 * resolved once and then mapped through edits, so they follow the text while the person types.
 */

export type QuoteSourceState = 'used' | 'missing';
export type QuoteDecoration = { range: TextRange; state: QuoteSourceState };
/** Words a suggestion puts in, read after what it takes out (`offset` in the block's text). */
export type SuggestionInsertion = { blockId: BlockId; offset: number; text: string };
export type SuggestionDecoration = {
  id: string;
  /** What the suggestion takes out (struck through). */
  ranges: readonly TextRange[];
  /** What it puts in, as insertions in the paragraph (needs the widget factory). */
  insertions?: readonly SuggestionInsertion[];
  stale?: boolean;
};

/**
 * The Design System widget factory (`proseWidgets`), handed in by the client: the editor never
 * creates DOM itself, and `node --test` runs without the Design System.
 */
export type ProseWidgetFactory = {
  insertion: (text: string, options?: { stale?: boolean; label?: string }) => HTMLElement;
  gutterMarker: (kind?: 'ai', options?: { label?: string; onActivate?: (event: Event) => void }) => HTMLElement;
};

/** What the widgets do when used; read at the moment of use (React swaps them freely). */
export type ArticleWidgetHandlers = {
  /** The AI marker of a block was clicked (or activated by keyboard). */
  onAiMarker?: (blockId: BlockId) => void;
};

export type ArticleDecorationInput = {
  activeSourceBlockIds: readonly BlockId[];
  suggestions: readonly SuggestionDecoration[];
  quotes: readonly QuoteDecoration[];
  stale: readonly TextRange[];
  /** Reviewer-pointed passages (absent = none). */
  pointed?: readonly TextRange[];
  /** Block with a floating bar under it (`data-bar-space="below"`); absent or null = none. */
  barSpace?: BlockId | null;
};

/** New inputs replace a layer; `dropSuggestionIds` removes decided suggestions where they are now. */
export type ArticleDecorationPatch = Partial<ArticleDecorationInput> & { dropSuggestionIds?: readonly string[] };

type RangeLayer = 'suggestions' | 'quotes' | 'stale' | 'pointed';

export type ArticleDecorationsState = {
  input: ArticleDecorationInput;
  layers: Record<RangeLayer, DecorationSet>;
  /** Blocks a generation is writing now; `null` when no generation streams into the text. */
  writing: readonly BlockId[] | null;
  set: DecorationSet;
};

export type ArticleDecorationsOptions = {
  /** Screen-reader description of an unreviewed AI block (Prose asks for `aria-description`). */
  aiDescription?: string;
  /** Design System widgets (proposal insertions, AI gutter marker). Without it: attributes only. */
  widgets?: ProseWidgetFactory;
  /** Read when a widget is used. */
  handlers?: () => ArticleWidgetHandlers | undefined;
};

type Resolved = { aiDescription: string; widgets?: ProseWidgetFactory; handlers?: () => ArticleWidgetHandlers | undefined };

export const EMPTY_DECORATION_INPUT: ArticleDecorationInput = { activeSourceBlockIds: [], suggestions: [], quotes: [], stale: [], pointed: [] };

export const articleDecorationsKey = new PluginKey<ArticleDecorationsState>('reporterArticleDecorations');

const DEFAULT_AI_DESCRIPTION = 'Texto da IA não revisado';
const STALE_INSERTION_LABEL = 'Sugestão desatualizada:';

/** Blocks whose start holds a caret position for the gutter marker (not images or rules). */
const MARKER_SKIPPED = new Set<string>([NODE.figure, NODE.divider]);

function inline(doc: PMNode, range: TextRange, attrs: Record<string, string>, spec?: Record<string, unknown>): Decoration | null {
  const positions = textRangeToPositions(doc, range);
  if (!positions || positions.from >= positions.to) return null;
  return Decoration.inline(positions.from, positions.to, attrs, spec);
}

function compact(decorations: readonly (Decoration | null)[]): Decoration[] {
  return decorations.filter((decoration): decoration is Decoration => decoration !== null);
}

/** Position of an insertion: the offset in its block, clamped to the block's text. */
function insertionPos(doc: PMNode, insertion: SuggestionInsertion): number | null {
  const entry = findBlockEntry(doc, insertion.blockId);
  if (!entry || MARKER_SKIPPED.has(entry.node.type.name)) return null;
  const length = blockTextOf(entry.node).length;
  return offsetToPos(entry, Math.max(0, Math.min(insertion.offset, length)));
}

function insertionWidgets(doc: PMNode, suggestion: SuggestionDecoration, widgets: ProseWidgetFactory | undefined): Decoration[] {
  if (!widgets) return [];
  const stale = suggestion.stale === true;
  return (suggestion.insertions ?? []).flatMap((insertion, index) => {
    const text = insertion.text;
    const pos = insertionPos(doc, insertion);
    if (pos === null || !text.trim()) return [];
    const toDOM = () => widgets.insertion(text, stale ? { stale, label: STALE_INSERTION_LABEL } : undefined);
    // After the struck words (side 1: typing there goes before the proposal); keyed by content so
    // ProseMirror keeps the node while nothing changes.
    return [Decoration.widget(pos, toDOM, { side: 1, key: `ins:${suggestion.id}:${index}:${stale ? 's' : ''}:${text}`, suggestionId: suggestion.id })];
  });
}

function buildLayer(doc: PMNode, layer: RangeLayer, input: ArticleDecorationInput, options: Resolved): DecorationSet {
  let decorations: Decoration[] = [];
  if (layer === 'suggestions') {
    decorations = input.suggestions.flatMap((suggestion) => [
      ...compact(
        suggestion.ranges.map((range) =>
          inline(
            doc,
            range,
            { [DATA_ATTR.suggestion]: 'delete', ...(suggestion.stale ? { [DATA_ATTR.stale]: '' } : {}) },
            { suggestionId: suggestion.id },
          ),
        ),
      ),
      ...insertionWidgets(doc, suggestion, options.widgets),
    ]);
  } else if (layer === 'quotes') {
    decorations = compact(input.quotes.map((quote) => inline(doc, quote.range, { [DATA_ATTR.sourceState]: quote.state })));
  } else if (layer === 'pointed') {
    decorations = compact((input.pointed ?? []).map((range) => inline(doc, range, { nodeName: 'mark', [DATA_ATTR.pointed]: '' })));
  } else {
    decorations = compact(input.stale.map((range) => inline(doc, range, { [DATA_ATTR.stale]: '' })));
  }
  return DecorationSet.create(doc, decorations);
}

/** The factory's gutter marker at the start of an unreviewed AI block ("Revisar texto da IA"). */
function aiMarker(pos: number, blockId: BlockId, options: Resolved): Decoration | null {
  const { widgets, handlers } = options;
  if (!widgets) return null;
  const toDOM = () => widgets.gutterMarker('ai', { onActivate: () => handlers?.()?.onAiMarker?.(blockId) });
  // The editor ignores the marker's own events (it keeps the caret and the selection).
  return Decoration.widget(pos + 1, toDOM, { side: -1, key: `ai:${blockId}`, ignoreSelection: true, stopEvent: () => true });
}

/**
 * Decorations derived from the document and the lit source blocks. The AI marker sits on the block
 * node (with the factory's clickable marker inside); while a generation writes, only the block
 * being written is marked, so the text never reads as a bulleted list. The lit-source highlight is
 * an inline decoration over the block's text, because Prose draws it as a background on a span (a
 * block-level underline band turned dark under text selection).
 */
function blockDecorations(
  doc: PMNode,
  activeSource: readonly BlockId[],
  writing: readonly BlockId[] | null,
  options: Resolved,
  barSpace: BlockId | null = null,
): Decoration[] {
  const active = new Set(activeSource);
  const current = writing ? writing[writing.length - 1] : undefined;
  const decorations: Decoration[] = [];
  doc.forEach((node, pos) => {
    const id = blockIdOf(node);
    const end = pos + node.nodeSize;
    if (id && id === barSpace) decorations.push(Decoration.node(pos, end, { [DATA_ATTR.barSpace]: 'below' }));
    if (writing) {
      if (id && id === current) decorations.push(Decoration.node(pos, end, { [DATA_ATTR.ai]: 'writing' }));
    } else if (node.attrs[BLOCK_ATTR.ai] === 'unreviewed') {
      decorations.push(Decoration.node(pos, end, { [DATA_ATTR.ai]: 'unreviewed', 'aria-description': options.aiDescription }));
      const marker = id && !MARKER_SKIPPED.has(node.type.name) ? aiMarker(pos, id, options) : null;
      if (marker) decorations.push(marker);
    }
    const from = pos + 1;
    const to = end - 1;
    if (id && active.has(id) && from < to) decorations.push(Decoration.inline(from, to, { [DATA_ATTR.sourceActive]: '' }));
  });
  return decorations;
}

function combine(
  doc: PMNode,
  layers: Record<RangeLayer, DecorationSet>,
  input: ArticleDecorationInput,
  writing: readonly BlockId[] | null,
  options: Resolved,
): DecorationSet {
  return DecorationSet.create(doc, [
    ...blockDecorations(doc, input.activeSourceBlockIds, writing, options, input.barSpace ?? null),
    ...layers.suggestions.find(),
    ...layers.quotes.find(),
    ...layers.stale.find(),
    ...layers.pointed.find(),
  ]);
}

const RANGE_LAYERS: readonly RangeLayer[] = ['suggestions', 'quotes', 'stale', 'pointed'];

function resolveOptions(options: ArticleDecorationsOptions): Resolved {
  return { aiDescription: options.aiDescription ?? DEFAULT_AI_DESCRIPTION, widgets: options.widgets, handlers: options.handlers };
}

/**
 * Pure builder of the full decoration set (used by the plugin and the tests). `writing`: the blocks
 * a generation is writing now (only the last one is marked); omit when no generation streams.
 */
export function buildArticleDecorations(
  doc: PMNode,
  input: ArticleDecorationInput,
  options: ArticleDecorationsOptions & { writing?: readonly BlockId[] } = {},
): DecorationSet {
  const resolved = resolveOptions(options);
  const layers = {
    suggestions: buildLayer(doc, 'suggestions', input, resolved),
    quotes: buildLayer(doc, 'quotes', input, resolved),
    stale: buildLayer(doc, 'stale', input, resolved),
    pointed: buildLayer(doc, 'pointed', input, resolved),
  };
  return combine(doc, layers, input, options.writing ?? null, resolved);
}

/** What a stream transaction says about the blocks being written (`undefined`: no stream meta). */
function writingFrom(tr: Transaction): readonly BlockId[] | null | undefined {
  const meta = tr.getMeta(streamKey) as StreamMeta | undefined;
  if (!meta) return undefined;
  return meta.type === 'end' || meta.runId === null ? null : meta.inFlight;
}

export function articleDecorationsPlugin(options: ArticleDecorationsOptions = {}): Plugin<ArticleDecorationsState> {
  const resolved = resolveOptions(options);
  return new Plugin<ArticleDecorationsState>({
    key: articleDecorationsKey,
    state: {
      init(_config, state) {
        const layers = { suggestions: DecorationSet.empty, quotes: DecorationSet.empty, stale: DecorationSet.empty, pointed: DecorationSet.empty };
        return { input: EMPTY_DECORATION_INPUT, layers, writing: null, set: combine(state.doc, layers, EMPTY_DECORATION_INPUT, null, resolved) };
      },
      apply(tr, previous) {
        const patch = tr.getMeta(articleDecorationsKey) as ArticleDecorationPatch | undefined;
        const streamed = writingFrom(tr);
        const writing = streamed === undefined ? previous.writing : streamed;
        if (!patch && !tr.docChanged && writing === previous.writing) return previous;
        const { dropSuggestionIds, ...set } = patch ?? {};
        const input = { ...previous.input, ...set };
        const layers = { ...previous.layers };
        for (const layer of RANGE_LAYERS) {
          if (set[layer] !== undefined) layers[layer] = buildLayer(tr.doc, layer, input, resolved);
          else if (tr.docChanged) layers[layer] = layers[layer].map(tr.mapping, tr.doc);
        }
        if (dropSuggestionIds && dropSuggestionIds.length > 0) {
          const drop = new Set(dropSuggestionIds);
          input.suggestions = input.suggestions.filter((suggestion) => !drop.has(suggestion.id));
          const decided = layers.suggestions.find(undefined, undefined, (spec) => drop.has(spec.suggestionId as string));
          layers.suggestions = layers.suggestions.remove(decided);
        }
        return { input, layers, writing, set: combine(tr.doc, layers, input, writing, resolved) };
      },
    },
    props: {
      decorations(state) {
        return articleDecorationsKey.getState(state)?.set ?? null;
      },
    },
  });
}

/** Adds a decoration patch to a transaction (no document change, no history entry). */
export function withArticleDecorations(tr: Transaction, patch: ArticleDecorationPatch): Transaction {
  return tr.setMeta(articleDecorationsKey, patch).setMeta('addToHistory', false);
}

/** Sets one or more decoration inputs from React (e.g. on hover, on new quote checks). */
export function setArticleDecorations(view: ViewLike, patch: ArticleDecorationPatch): void {
  view.dispatch(withArticleDecorations(view.state.tr, patch));
}

export function articleDecorationInput(state: EditorState): ArticleDecorationInput {
  return articleDecorationsKey.getState(state)?.input ?? EMPTY_DECORATION_INPUT;
}
