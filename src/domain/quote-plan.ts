/**
 * How many literal quotations each part of a text should carry. A part whose evidence holds a
 * quotable line of an identified speaker gets one when its format asks for quotes there (the
 * opening only in a stand coverage), and more when the later parts cannot reach the text's minimum.
 * The writer asks a part at most once for the quote its evidence allows; a part that still has none
 * never fails the text.
 */
import { countWords } from './text/stats.ts';

export const QUOTABLE_MIN_WORDS = 4;

/** Where a text wants quotations: its minimum, and whether the opening and the sections carry one. */
export type QuoteRule = { minQuotes: number; openingQuote: boolean; sectionQuotes: boolean };
export type QuotableCandidate = { key: string; text: string; speaker?: string };

/** The ids of sentences an identified speaker said, with four words or more, that are not questions. */
export function quotableIds(ids: readonly string[], candidates: ReadonlyMap<string, QuotableCandidate>,
  identified: (candidate: QuotableCandidate) => boolean): string[] {
  return [...new Set(ids)].filter(id => {
    const candidate = candidates.get(id);
    return Boolean(candidate && identified(candidate) && countWords(candidate.text) >= QUOTABLE_MIN_WORDS
      && !/\?[”"»')]*$/u.test(candidate.text.trim()));
  });
}

/**
 * The quotations part `index` (0 is the opening) should carry. `available` counts each part's
 * quotable ids and `quoted` the distinct quotations already written: a part takes one where it can,
 * plus what the minimum still needs that the later parts cannot give.
 */
export function quoteRequirement({ rule, quoted, available, index }: { rule: QuoteRule; quoted: number; available: readonly number[]; index: number }): number {
  const base = (part: number) => (available[part] ?? 0) > 0 && (part === 0 ? rule.openingQuote : rule.sectionQuotes) ? 1 : 0;
  const need = Math.max(0, rule.minQuotes - quoted);
  let later = 0;
  for (let part = index + 1; part < available.length; part++) later += Math.min(available[part] ?? 0, base(part));
  return Math.min(available[index] ?? 0, Math.max(base(index), need - later));
}
