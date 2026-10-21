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

const word = (pattern: string, flags = 'u') => new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, flags);
/** A thank-you is a courtesy, never a position, a number, a reason or a forecast. */
const THANKS = word('obrigad[oa]s?|agrade[cç]\\p{L}*', 'iu');
/** How an interviewer asks for an answer without a question mark: "Fale um pouco sobre…", "Conta pra gente…". */
const PROMPTING = /^(?:me\s+)?(?:fal[ae]|cont[ae]|expliqu?e|explica|diga|diz)\s+(?:um pouco|pra gente|para a gente|pra nós|para nós|sobre)(?![\p{L}\p{N}])/iu;
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Who said a line, for quoting it with a name. A linked speaker always; a line without a speaker
 * label only in a stand interview (`unlabeledAnswers`) with one confirmed person, whose answers
 * those are. Even there, a line that names her (the interviewer calls, presents or thanks her),
 * thanks someone or asks for an answer is the interviewer's.
 */
export function quotableSpeaker({ linked, people, unlabeledAnswers }: { linked: ReadonlySet<string>; people: readonly { name: string }[]; unlabeledAnswers: boolean }): (candidate: QuotableCandidate) => boolean {
  const names = unlabeledAnswers && people.length === 1 ? people[0].name.split(/\s+/u).filter(name => /^\p{Lu}\p{L}{2,}/u.test(name)) : undefined;
  const named = names?.length ? word(names.map(escaped).join('|')) : undefined;
  return candidate => candidate.speaker ? linked.has(candidate.speaker)
    : Boolean(names) && !named?.test(candidate.text) && !THANKS.test(candidate.text) && !PROMPTING.test(candidate.text.trim());
}

/** The ids of sentences an identified speaker said, with four words or more, that are neither questions nor thanks. */
export function quotableIds(ids: readonly string[], candidates: ReadonlyMap<string, QuotableCandidate>,
  identified: (candidate: QuotableCandidate) => boolean): string[] {
  return [...new Set(ids)].filter(id => {
    const candidate = candidates.get(id);
    return Boolean(candidate && identified(candidate) && countWords(candidate.text) >= QUOTABLE_MIN_WORDS
      && !/\?[”"»')]*$/u.test(candidate.text.trim()) && !THANKS.test(candidate.text));
  });
}

type QuoteNeed = { rule: QuoteRule; quoted: number; available: readonly number[]; index: number };
const base = (rule: QuoteRule, available: readonly number[], part: number) =>
  (available[part] ?? 0) > 0 && (part === 0 ? rule.openingQuote : rule.sectionQuotes) ? 1 : 0;

/**
 * The quotations of part `index` (0 is the opening) the text's minimum depends on: what the minimum
 * still needs that the later parts cannot give. `available` counts each part's quotable ids and
 * `quoted` the distinct quotations already written.
 */
export function essentialQuotes({ rule, quoted, available, index }: QuoteNeed): number {
  const need = Math.max(0, rule.minQuotes - quoted);
  let later = 0;
  for (let part = index + 1; part < available.length; part++) later += Math.min(available[part] ?? 0, base(rule, available, part));
  return Math.min(available[index] ?? 0, Math.max(0, need - later));
}

/** The quotations part `index` should carry: one where its evidence allows, plus the essential ones. */
export function quoteRequirement(need: QuoteNeed): number {
  return Math.max(base(need.rule, need.available, need.index), essentialQuotes(need));
}
