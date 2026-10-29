import { closeHistory } from '@tiptap/pm/history';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { replaceTextRange } from '../domain/article.ts';
import { memoryArticleContentIssues, memoryArticleReferences } from '../domain/editorial-memory-article.ts';
import { memoryWritingExcerpt } from '../domain/editorial-memory-excerpt.ts';
import { extractQuotes, type QuoteCheck } from '../domain/quotes.ts';
import { dedupeRefs, refKey, segmentRef, type SourceRef } from '../domain/refs.ts';
import { sourceContentHash, type Source } from '../domain/source.ts';
import { blockNode, nodeBlock } from './nodes.ts';
import { findBlockEntry, offsetToPos } from './ranges.ts';
import { streamState } from './streaming.ts';
import type { ViewLike } from './view.ts';

type RecoveryQuote = Pick<QuoteCheck, 'range' | 'text' | 'sourceRefs'>;
type RecoveryExcerpt = { text: string; ref: SourceRef };
const sameOrigin = (a: SourceRef, b: SourceRef) => a.sourceId === b.sourceId && a.sourceVersion === b.sourceVersion
  && a.locator.type === 'segment' && b.locator.type === 'segment' && a.locator.segmentId === b.locator.segmentId;

/** Revalidate the live quote and literal origin; update words and exact receipts in one history step. */
export function sourceQuoteTransaction(state: EditorState, quote: RecoveryQuote, excerpt: RecoveryExcerpt, sources: readonly Source[]): Transaction | undefined {
  const { range } = quote, ref = excerpt.ref, entry = findBlockEntry(state.doc, range.blockId), block = entry && nodeBlock(entry.node);
  if (!entry || !block || block.type !== 'quote' && block.type !== 'paragraph' || ref.locator.type !== 'segment'
    || streamState(state).inFlight.includes(range.blockId)) return undefined;
  const before = { type: 'article' as const, title: '', blocks: [block] }, quotes = extractQuotes(before);
  if (!quotes.some(item => item.range.from === range.from && item.range.to === range.to && item.text === quote.text)
    || (block.sourceRefs ?? []).map(refKey).sort().join('|') !== quote.sourceRefs.map(refKey).sort().join('|')) return undefined;
  const segmentId = ref.locator.segmentId;
  const source = sources.find(source => source.id === ref.sourceId), version = source?.versions.find(version => version.number === ref.sourceVersion);
  const segment = version?.content.segments.find(segment => segment.id === segmentId);
  const from = ref.locator.from ?? 0, to = ref.locator.to ?? segment?.text.length ?? 0;
  if (!source?.rights.authorized || !version || sourceContentHash(version.content) !== version.hash || !segment
    || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > segment.text.length
    || segment.text.slice(from, to) !== excerpt.text || !excerpt.text.trim()) return undefined;
  if (quote.sourceRefs.length && !quote.sourceRefs.some(original => sameOrigin(original, ref))) return undefined;
  if (source.memory && memoryWritingExcerpt(source, version.number, { segmentId: segment.id, start: from, end: to, text: excerpt.text })?.kind !== 'citation') return undefined;
  const replaced = replaceTextRange(before, range, excerpt.text);
  if (!replaced.ok) return undefined;
  const changed = replaced.value.blocks[0], others = (block.sourceRefs ?? []).filter(original => !sameOrigin(original, ref));
  const multiple = quotes.length > 1;
  const own = source.memory ? memoryArticleReferences(changed, [segmentRef(source.id, version.number, segment.id, { from: 0, to: segment.text.length })], sources)
    : dedupeRefs([...(multiple ? (block.sourceRefs ?? []).filter(original => sameOrigin(original, ref)) : []), ref]);
  changed.sourceRefs = dedupeRefs([...others, ...own]);
  if (memoryArticleContentIssues({ ...replaced.value, blocks: [changed] }, sources).length) return undefined;
  const node = blockNode(state.schema, changed), tr = state.tr.replaceWith(entry.pos, entry.pos + entry.node.nodeSize, node);
  tr.setSelection(TextSelection.near(tr.doc.resolve(offsetToPos({ node, pos: entry.pos }, range.from + excerpt.text.length))));
  return closeHistory(tr).scrollIntoView();
}

export function recoverSourceQuote(view: ViewLike, quote: RecoveryQuote, excerpt: RecoveryExcerpt, sources: readonly Source[]): boolean {
  const tr = sourceQuoteTransaction(view.state, quote, excerpt, sources);
  if (!tr) return false;
  view.dispatch(tr);
  view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false));
  return true;
}
