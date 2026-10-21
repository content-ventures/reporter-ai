import type { ArticleBody } from './article.ts';
import { literalQuoteText, quoteKey, quotedWords } from './article-policy.ts';
import { citationId, locateCitation } from './citation-library.ts';
import type { Citation } from './citation-library.ts';
import type { EvidenceCandidate } from './evidence-hints.ts';
import { extractQuotes, MIN_INLINE_QUOTE_WORDS } from './quotes.ts';
import type { SourceRef } from './refs.ts';
import { resolveSourceRef } from './source.ts';
import type { Source, TranscriptSegment } from './source.ts';
import { articleSentences } from './text/sentences.ts';
import { countWords } from './text/stats.ts';

/**
 * Suggested citations: passages the outline selected for a text that the text did not quote. They
 * go to the citation bank as "Sugerida", never confirmed: a person checks them against the source.
 * Only a linked speaker's words qualify, and the bank keeps a bounded number per production.
 */

export const SUGGESTIONS_PER_RUN = 10, SUGGESTIONS_PER_PRODUCTION = 40, LIBRARY_CAP = 5000;
const PASSAGE_CHARS = 1200;

export function isSuggestedCitation(c: Pick<Citation, 'origin' | 'authorConfirmed'>): boolean { return c.origin === 'outline' && !c.authorConfirmed; }

type Range = { from: number; to: number };
const segmentKey = (ref: SourceRef) => ref.locator.type === 'segment' ? `${ref.sourceId}\u0000${ref.sourceVersion}\u0000${ref.locator.segmentId}` : undefined;
const literalWords = (text: string) => quotedWords(literalQuoteText(text));
const overlaps = (a: Range, b: Range) => a.from < b.to && b.from < a.to;

function candidateRange(candidate: EvidenceCandidate, segment: TranscriptSegment): Range {
  const locator = candidate.ref.locator;
  return locator.type === 'segment' ? { from: locator.from ?? 0, to: locator.to ?? segment.text.length } : { from: 0, to: segment.text.length };
}

/** Where each quotation of the text sits in the segments its block cites. */
function quotedRanges(body: ArticleBody, candidates: readonly EvidenceCandidate[], sources: readonly Source[]): Map<string, Range[]> {
  const ranges = new Map<string, Range[]>();
  for (const quote of extractQuotes(body)) {
    const words = literalWords(quote.text);
    if (!words || countWords(words) < MIN_INLINE_QUOTE_WORDS) continue;
    const seen = new Set<string>();
    for (const ref of quote.sourceRefs) {
      const where = segmentKey(ref), segment = resolveSourceRef(sources, ref)?.segment;
      if (!where || !segment || seen.has(where)) continue;
      seen.add(where);
      const found = ranges.get(where) ?? [];
      let at = segment.text.indexOf(words);
      const lowered = quoteKey(words);
      if (at < 0 && lowered !== words) at = segment.text.indexOf(lowered);
      if (at >= 0) found.push({ from: at, to: at + words.length });
      // The quotation reached the text with other spacing: every sentence it holds, or that holds it, is quoted.
      else for (const candidate of candidates) {
        const said = literalWords(candidate.text);
        if (said && segmentKey(candidate.ref) === where && (said.includes(words) || words.includes(said))) found.push(candidateRange(candidate, segment));
      }
      ranges.set(where, found);
    }
  }
  return ranges;
}

/** At most PASSAGE_CHARS characters, dropping whole sentences from the end. */
function boundedPassage(text: string): string {
  let passage = text;
  while (passage.length > PASSAGE_CHARS) {
    const sentences = articleSentences(passage);
    if (sentences.length < 2) return '';
    passage = sentences.slice(0, -1).join(' ');
  }
  return passage;
}

/** Outline passages the text did not quote, as untouched suggestions of linked speakers, opening first. */
export function suggestedCitations(input: { body: ArticleBody; selected: readonly string[]; candidates: readonly EvidenceCandidate[];
  sources: readonly Source[]; productionId: string; now: string; limit?: number }): Citation[] {
  const { body, selected, candidates, sources, productionId, now, limit = SUGGESTIONS_PER_RUN } = input;
  const quoted = quotedRanges(body, candidates, sources);
  const byKey = new Map(candidates.map(candidate => [candidate.key, candidate]));
  const groups = new Map<string, { source: Source; sourceVersion: number; segment: TranscriptSegment; ranges: Range[] }>();
  for (const key of new Set(selected)) {
    const candidate = byKey.get(key), where = candidate && segmentKey(candidate.ref);
    const resolved = candidate && resolveSourceRef(sources, candidate.ref);
    if (!candidate || !where || !resolved?.segment) continue;
    const range = candidateRange(candidate, resolved.segment);
    if ((quoted.get(where) ?? []).some(entry => overlaps(entry, range))) continue;
    const group = groups.get(where) ?? { source: resolved.source, sourceVersion: candidate.ref.sourceVersion, segment: resolved.segment, ranges: [] };
    group.ranges.push(range);
    groups.set(where, group);
  }
  const found = new Map<string, Citation>();
  for (const { source, sourceVersion, segment, ranges } of groups.values()) {
    if (!source.rights.authorized) continue;
    // Sentences that touch (only whitespace between them) are one passage.
    const passages: Range[] = [];
    for (const range of [...ranges].sort((a, b) => a.from - b.from)) {
      const last = passages.at(-1);
      if (last && (range.from <= last.to || !segment.text.slice(last.to, range.from).trim())) last.to = Math.max(last.to, range.to);
      else passages.push({ ...range });
    }
    for (const passage of passages) {
      if (found.size >= limit) return [...found.values()];
      const text = boundedPassage(segment.text.slice(passage.from, passage.to).trim());
      const located = text ? locateCitation(source, sourceVersion, text, segment.id) : undefined;
      if (!located?.personId) continue;
      const id = citationId(located.ref, located.text);
      if (found.has(id)) continue;
      found.set(id, { id, revision: 0, origin: 'outline', text: located.text, ref: located.ref, sourceHash: located.hash,
        productionId, createdAt: now, updatedAt: now, authorConfirmed: false, personId: located.personId, relevance: '',
        ...(source.programName ? { podcastName: source.programName } : {}),
        ...(source.sourceUrl ? { podcastUrl: source.sourceUrl } : {}),
        ...(source.recordedOn ? { recordedOn: source.recordedOn } : {}),
        ...(source.location ? { location: source.location } : {}) });
    }
  }
  return [...found.values()];
}

/** Same segment, and one text holds the other. */
function sameWords(a: Citation, b: Citation): boolean {
  return segmentKey(a.ref) === segmentKey(b.ref) && (a.text.includes(b.text) || b.text.includes(a.text));
}

/**
 * The bank after a run's entries: a quotation of the text replaces the untouched suggestions it covers;
 * a suggestion never repeats an entry's words and stays within SUGGESTIONS_PER_PRODUCTION. Suggestions do
 * not count toward `cap`, which holds the entries people and texts keep.
 */
export function mergeCitationAdditions(existing: readonly Citation[], additions: readonly Citation[], productionId: string, cap = LIBRARY_CAP): Citation[] {
  let entries = [...existing];
  for (const addition of additions) {
    const suggested = isSuggestedCitation(addition);
    if (addition.origin === 'article') entries = entries.filter(entry => !(isSuggestedCitation(entry) && entry.revision === 0 && sameWords(entry, addition)));
    if (entries.some(entry => entry.id === addition.id)) continue;
    if (suggested && (entries.some(entry => sameWords(entry, addition))
      || entries.filter(entry => entry.productionId === productionId && isSuggestedCitation(entry)).length >= SUGGESTIONS_PER_PRODUCTION)) continue;
    if (entries.filter(entry => !isSuggestedCitation(entry)).length >= cap) continue;
    entries.push(addition);
  }
  return entries;
}
