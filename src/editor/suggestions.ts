import type { Node as PMNode } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { applySuggestion, refuse } from '../domain/index.ts';
import type { ApplySuggestionRefusal, ArticleBlock, ArticleBody, Result, Suggestion, TextRange } from '../domain/index.ts';
import { articleDecorationsKey } from './decorations.ts';
import type { ArticleDecorationPatch, SuggestionDecoration } from './decorations.ts';
import { blockNode, docBody } from './nodes.ts';
import { blockTextOf, findBlockEntry, posToBlockOffset, textRangeToPositions } from './ranges.ts';
import { streamState, touchesBlocks } from './streaming.ts';
import type { ViewLike } from './view.ts';

/**
 * Suggestions against the live document. Location and staleness follow the domain rules
 * (`locateTargets`) on the editor's own text, without serialising the document; accepting
 * applies the domain `applySuggestion` result as ONE transaction: one ⌘Z reverts it, and the
 * touched blocks are AI text to review (`unreviewed`: the review of the whole text reopens).
 */

export const SUGGESTION_META = 'reporterSuggestion';

type Located = Pick<Suggestion, 'target' | 'anchorText'>;

function sliceBlock(doc: PMNode, range: TextRange): string | undefined {
  const entry = findBlockEntry(doc, range.blockId);
  if (!entry) return undefined;
  const text = blockTextOf(entry.node);
  if (range.from < 0 || range.from > range.to || range.to > text.length) return undefined;
  return text.slice(range.from, range.to);
}

/**
 * Where each target is now (same algorithm as the domain `locateTargets`): a range whose text
 * still matches stays; otherwise the anchor text must occur exactly once in the same block.
 * `undefined` = stale ("Trecho mudou · Reaplicar").
 */
export function locateSuggestionInDoc(doc: PMNode, suggestion: Located): TextRange[] | undefined {
  const located: TextRange[] = [];
  for (const [index, range] of suggestion.target.entries()) {
    const expected = suggestion.anchorText[index];
    if (expected === undefined) return undefined;
    if (sliceBlock(doc, range) === expected) {
      located.push(range);
      continue;
    }
    const entry = findBlockEntry(doc, range.blockId);
    if (!entry || !expected) return undefined;
    const text = blockTextOf(entry.node);
    const first = text.indexOf(expected);
    if (first < 0 || text.indexOf(expected, first + 1) >= 0) return undefined;
    located.push({ blockId: range.blockId, from: first, to: first + expected.length });
  }
  return located;
}

export function isSuggestionStaleInDoc(doc: PMNode, suggestion: Pick<Suggestion, 'target' | 'anchorText' | 'proposal'>): boolean {
  if (suggestion.proposal.kind === 'title' || suggestion.proposal.kind === 'slide') return false;
  return locateSuggestionInDoc(doc, suggestion) === undefined;
}

/** Decoration input for pending suggestions: located targets, or the original ones marked stale. */
export function suggestionDecorations(doc: PMNode, suggestions: readonly Suggestion[]): SuggestionDecoration[] {
  return suggestions
    .filter((suggestion) => suggestion.state === 'ready' || suggestion.state === 'streaming' || suggestion.state === 'stale')
    .filter((suggestion) => suggestion.proposal.kind !== 'title' && suggestion.proposal.kind !== 'slide')
    .map((suggestion) => {
      const located = suggestion.state === 'stale' ? undefined : locateSuggestionInDoc(doc, suggestion);
      return located
        ? { id: suggestion.id, ranges: located }
        : { id: suggestion.id, ranges: suggestion.target.filter((range) => textRangeToPositions(doc, range)), stale: true };
    });
}

/**
 * The pending suggestion whose passage holds the caret (its words, or right at their edges), so
 * the bar near the text opens when the caret enters it. A stale one counts where its passage was.
 * `null` with text selected (the selection bar owns that moment) or outside every passage.
 */
export function suggestionAtCaret(
  state: Pick<EditorState, 'doc' | 'selection'>,
  suggestions: readonly Pick<Suggestion, 'id' | 'target' | 'anchorText' | 'proposal' | 'state'>[],
): string | null {
  const { selection, doc } = state;
  if (!selection.empty) return null;
  const at = posToBlockOffset(doc, selection.from);
  if (!at) return null;
  for (const suggestion of suggestions) {
    if (suggestion.proposal.kind === 'title' || suggestion.proposal.kind === 'slide') continue;
    const ranges = (suggestion.state === 'stale' ? undefined : locateSuggestionInDoc(doc, suggestion)) ?? suggestion.target;
    if (ranges.some((range) => range.blockId === at.blockId && range.from <= at.offset && at.offset <= range.to)) return suggestion.id;
  }
  return null;
}

function sameBlock(a: ArticleBlock, b: ArticleBlock): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Changed run of blocks between two bodies (same prefix and suffix trimmed). */
function changedSpan(before: readonly ArticleBlock[], after: readonly ArticleBlock[]): { start: number; endBefore: number; endAfter: number } | null {
  let start = 0;
  while (start < before.length && start < after.length && sameBlock(before[start], after[start])) start += 1;
  if (start === before.length && start === after.length) return null;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && sameBlock(before[endBefore - 1], after[endAfter - 1])) {
    endBefore -= 1;
    endAfter -= 1;
  }
  return { start, endBefore, endAfter };
}

/** `streaming`: the target is a block a generation is still writing (read-only until it ends). */
export type SuggestionTransactionRefusal = ApplySuggestionRefusal | 'not_in_document' | 'streaming';

/**
 * The transaction that applies an accepted suggestion. The result equals the domain
 * `applySuggestion(docBody(doc), suggestion)`; a one-block text change only touches the changed
 * characters, so the caret elsewhere in that block stays put.
 */
export function suggestionTransaction(state: EditorState, suggestion: Suggestion): Result<Transaction, SuggestionTransactionRefusal> {
  if (suggestion.proposal.kind === 'title') return refuse('unsupported', 'O título fica fora do texto do artigo.');
  const before = docBody(state.doc, { keepEmpty: true });
  const applied = applySuggestion(before, suggestion);
  if (!applied.ok) return applied;
  const span = changedSpan(before.blocks, applied.value.blocks);
  const tr = state.tr;
  if (span) {
    const first = findBlockEntry(state.doc, before.blocks[span.start]?.id ?? '');
    const lastBlock = before.blocks[span.endBefore - 1];
    const last = lastBlock ? findBlockEntry(state.doc, lastBlock.id) : undefined;
    const replacement = applied.value.blocks.slice(span.start, span.endAfter).map((block) => blockNode(state.schema, block));
    if (!first || !last) return refuse('not_in_document', 'O trecho não está mais no texto.');
    const from = first.pos;
    const to = last.pos + last.node.nodeSize;
    const single = span.endBefore - span.start === 1 && replacement.length === 1 ? replacement[0] : null;
    if (single && single.type === first.node.type && single.attrs.level === first.node.attrs.level) {
      const diffStart = first.node.content.findDiffStart(single.content);
      if (diffStart !== null) {
        const diffEnd = first.node.content.findDiffEnd(single.content);
        const startA = diffStart;
        let endA = diffEnd ? diffEnd.a : first.node.content.size;
        let endB = diffEnd ? diffEnd.b : single.content.size;
        // Overlapping diff ends (repeated characters): widen so both sides cover the change.
        const overlap = Math.max(0, startA - Math.min(endA, endB));
        endA += overlap;
        endB += overlap;
        tr.replace(from + 1 + startA, from + 1 + endA, single.slice(startA, endB));
      }
      for (const [name, value] of Object.entries(single.attrs)) {
        if (JSON.stringify(first.node.attrs[name]) !== JSON.stringify(value)) tr.setNodeAttribute(from, name, value);
      }
    } else {
      tr.replaceWith(from, to, replacement);
    }
  }
  const { inFlight } = streamState(state);
  if (inFlight.length > 0 && touchesBlocks(tr, state.doc, inFlight)) return refuse('streaming', 'Aguarde a geração terminar este trecho.');
  closeHistory(tr);
  tr.setMeta(SUGGESTION_META, suggestion.id);
  tr.setMeta(articleDecorationsKey, { dropSuggestionIds: [suggestion.id] } satisfies ArticleDecorationPatch);
  return { ok: true, value: tr };
}

/**
 * Accept: dispatches the suggestion as its own undo step (history closed before and after) and
 * returns the resulting body (title from `title`). Call the store's `decideSuggestion` with the
 * same suggestion after flushing pending autosave.
 */
export function applySuggestionInEditor(
  view: ViewLike,
  suggestion: Suggestion,
  title = '',
): Result<ArticleBody, SuggestionTransactionRefusal> {
  const built = suggestionTransaction(view.state, suggestion);
  if (!built.ok) return built;
  view.dispatch(built.value);
  view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false));
  return { ok: true, value: docBody(view.state.doc, { title, keepEmpty: true }) };
}
