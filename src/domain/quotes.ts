import { blockText } from './article.ts';
import type { ArticleBody } from './article.ts';
import type { BlockId, SegmentId } from './ids.ts';
import type { SourceRef, TextRange } from './refs.ts';
import { currentSourceVersion, sourceVersion } from './source.ts';
import type { Source, TranscriptSegment } from './source.ts';
import { foldForMatch } from './text/normalize.ts';
import { countWords } from './text/stats.ts';

/**
 * Deterministic quote check (anticipates REQ-T.7 / F2.8): every quotation in the article is
 * compared with the transcript text. No model, no fuzziness beyond punctuation and case:
 * a quote is `verified` only when its words appear, in order, in the material.
 */

/** Inline quotations shorter than this are terms or names, not citations. */
export const MIN_INLINE_QUOTE_WORDS = 4;

export type ArticleQuote = {
  blockId: BlockId;
  range: TextRange;
  text: string;
  kind: 'block' | 'inline';
  sourceRefs: SourceRef[];
};

export type QuoteStatus = 'verified' | 'missing';

export type QuoteCheck = ArticleQuote & {
  status: QuoteStatus;
  /** Where the quote was found (preferring the block's own refs). */
  match?: SourceRef;
};

const INLINE_QUOTE = /“([^”]+)”|"([^"]+)"|«([^»]+)»/g;
/** Editorial omissions/insertions: "…", "...", "(...)", "[...]", "[a empresa]". */
const ELISION = /\s*(?:\[[^\]]*\]|\(\s*(?:\.\.\.|…)\s*\)|\.\.\.|…)\s*/;

function inlineQuotes(text: string): { from: number; to: number; text: string }[] {
  const found: { from: number; to: number; text: string }[] = [];
  for (const match of text.matchAll(INLINE_QUOTE)) {
    const inner = match[1] ?? match[2] ?? match[3] ?? '';
    const start = (match.index ?? 0) + 1;
    if (countWords(inner) >= MIN_INLINE_QUOTE_WORDS) found.push({ from: start, to: start + inner.length, text: inner });
  }
  return found;
}

export function extractQuotes(body: ArticleBody): ArticleQuote[] {
  const quotes: ArticleQuote[] = [];
  for (const block of body.blocks) {
    if (block.type !== 'paragraph' && block.type !== 'quote') continue;
    const text = blockText(block);
    const sourceRefs = block.sourceRefs ?? [];
    const inline = inlineQuotes(text);
    if (block.type === 'quote' && inline.length === 0) {
      const trimmedStart = text.length - text.trimStart().length;
      const inner = text.trim();
      if (inner) {
        quotes.push({
          blockId: block.id,
          range: { blockId: block.id, from: trimmedStart, to: trimmedStart + inner.length },
          text: inner,
          kind: 'block',
          sourceRefs,
        });
      }
      continue;
    }
    for (const quote of inline) {
      quotes.push({
        blockId: block.id,
        range: { blockId: block.id, from: quote.from, to: quote.to },
        text: quote.text,
        kind: block.type === 'quote' ? 'block' : 'inline',
        sourceRefs,
      });
    }
  }
  return quotes;
}

type Candidate = { text: string; ref: SourceRef };

function segmentRef(source: Source, version: number, segmentId: SegmentId): SourceRef {
  return { kind: 'source', sourceId: source.id, sourceVersion: version, locator: { type: 'segment', segmentId } };
}

/** Segments plus joins of consecutive same-speaker segments (a quote may span a split). */
function candidatesOf(source: Source, version: number, segments: readonly TranscriptSegment[]): Candidate[] {
  const out: Candidate[] = [];
  segments.forEach((segment, index) => {
    out.push({ text: foldForMatch(segment.text), ref: segmentRef(source, version, segment.id) });
    let joined = segment.text;
    for (let next = index + 1; next < Math.min(segments.length, index + 3); next += 1) {
      if (segments[next].speaker !== segment.speaker) break;
      joined += ` ${segments[next].text}`;
      out.push({ text: foldForMatch(joined), ref: segmentRef(source, version, segment.id) });
    }
  });
  return out;
}

function referencedCandidates(sources: readonly Source[], refs: readonly SourceRef[]): Candidate[] {
  const out: Candidate[] = [];
  for (const ref of refs) {
    if (ref.locator.type !== 'segment') continue;
    const segmentId = ref.locator.segmentId;
    const source = sources.find((candidate) => candidate.id === ref.sourceId);
    const version = source ? sourceVersion(source, ref.sourceVersion) : undefined;
    if (!source || !version) continue;
    const index = version.content.segments.findIndex((segment) => segment.id === segmentId);
    if (index < 0) continue;
    // The referenced segment, alone or joined with following segments of the same speaker.
    const nearby = version.content.segments.slice(index, index + 3);
    out.push(
      ...candidatesOf(source, ref.sourceVersion, nearby).filter(
        (candidate) => candidate.ref.locator.type === 'segment' && candidate.ref.locator.segmentId === segmentId,
      ),
    );
  }
  return out;
}

function allCandidates(sources: readonly Source[]): Candidate[] {
  return sources.flatMap((source) => {
    const version = currentSourceVersion(source);
    return candidatesOf(source, version.number, version.content.segments);
  });
}

/** True when every fragment of the quote appears in `haystack`, in order. */
export function quoteMatches(quote: string, haystack: string): boolean {
  const fragments = quote
    .split(ELISION)
    .map(foldForMatch)
    .filter((fragment) => fragment.length > 0);
  if (fragments.length === 0) return false;
  const padded = ` ${haystack} `;
  let cursor = 0;
  for (const fragment of fragments) {
    const at = padded.indexOf(` ${fragment} `, cursor);
    if (at < 0) return false;
    cursor = at + fragment.length + 1;
  }
  return true;
}

export function checkQuotes(body: ArticleBody, sources: readonly Source[]): QuoteCheck[] {
  const everywhere = allCandidates(sources);
  return extractQuotes(body).map((quote) => {
    const preferred = referencedCandidates(sources, quote.sourceRefs);
    const found = [...preferred, ...everywhere].find((candidate) => quoteMatches(quote.text, candidate.text));
    return found ? { ...quote, status: 'verified', match: found.ref } : { ...quote, status: 'missing' };
  });
}
