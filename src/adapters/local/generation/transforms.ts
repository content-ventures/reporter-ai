import { countWords } from '../../../domain/text/stats.ts';
import type { RewriteTone } from '../../../ports/generation.ts';
import { capitalize, sentenceSpans, withoutFinalPeriod } from './sentences.ts';

/**
 * Deterministic text transforms behind the simulated inline actions. They only remove filler,
 * restructure sentences or swap colloquial forms; they never add facts, and text between
 * quotation marks (someone's exact words) is never touched.
 */

const QUOTED = /“[^”]*”|"[^"]*"|«[^»]*»/g;

/** Applies `transform` to the text outside quotations only. */
function outsideQuotes(text: string, transform: (part: string) => string): string {
  // Edge whitespace belongs to the joints between parts, not to the transform.
  const apply = (part: string) => {
    const lead = /^\s*/.exec(part)?.[0] ?? '';
    const trail = part.length > lead.length ? (/\s*$/.exec(part)?.[0] ?? '') : '';
    return lead + transform(part.trim()).trim() + trail;
  };
  let out = '';
  let last = 0;
  for (const match of text.matchAll(QUOTED)) {
    const start = match.index ?? 0;
    out += apply(text.slice(last, start)) + match[0];
    last = start + match[0].length;
  }
  return out + apply(text.slice(last));
}

function tidy(text: string): string {
  return text
    .replace(/\s+([,.;:!?…])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/([.!?…])\s*,/g, '$1')
    .replace(/(^|[.!?…]\s+),\s*/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .replace(/(^|[.!?…]\s+)(\p{Ll})/gu, (_, before: string, letter: string) => before + letter.toLocaleUpperCase('pt-BR'));
}

/** Word boundaries that understand accents (`\b` does not: "tá", "né", "daí"). */
const LEFT = '(?<![\\p{L}\\p{N}])';
const RIGHT = '(?![\\p{L}\\p{N}])';

function wordPattern(source: string): RegExp {
  return new RegExp(`${LEFT}(?:${source})${RIGHT}`, 'giu');
}

/** Discourse fillers that add no information, with the commas around them. */
const FILLERS: readonly RegExp[] = [
  new RegExp(
    `,?\\s*${LEFT}(?:na verdade|basicamente|de certa forma|de alguma forma|digamos assim|por assim dizer|tipo assim|meio que|de fato)${RIGHT},?`,
    'giu',
  ),
  new RegExp(`,\\s*${LEFT}(?:né|sabe)${RIGHT}\\??`, 'giu'),
  new RegExp(`${LEFT}(?:simplesmente|literalmente)${RIGHT}\\s*`, 'giu'),
];

/** Meta-commentary openers: "é importante destacar que X" → "X". */
const META_OPENERS: readonly RegExp[] = [
  wordPattern('(?:é importante|vale|cabe) (?:destacar|ressaltar|lembrar|dizer|notar|mencionar) que\\s*'),
  wordPattern('é interessante (?:notar|observar) que\\s*'),
  wordPattern('o que acontece é que\\s*'),
  wordPattern('a verdade é que\\s*'),
];

const COLLOQUIAL: readonly [RegExp, string][] = [
  [wordPattern('pra'), 'para'],
  [wordPattern('pras'), 'para as'],
  [wordPattern('pros'), 'para os'],
  [wordPattern('pro'), 'para o'],
  [wordPattern('tá'), 'está'],
  [wordPattern('tô'), 'estou'],
  [wordPattern('num'), 'em um'],
  [wordPattern('numa'), 'em uma'],
  [wordPattern('duma'), 'de uma'],
  [wordPattern('dum'), 'de um'],
  [wordPattern('cê'), 'você'],
  [wordPattern('daí'), 'então'],
];

/** Removes a filler; commas on both sides collapse into a space, a single comma goes with it. */
function dropFiller(match: string): string {
  const lead = match.startsWith(',');
  const trail = match.endsWith(',');
  return lead && trail ? ' ' : lead || trail ? '' : ' ';
}

function keepCase(original: string, replacement: string): string {
  return /^\p{Lu}/u.test(original) ? capitalize(replacement) : replacement;
}

function removeFillers(text: string): string {
  let out = text;
  for (const pattern of META_OPENERS) out = out.replace(pattern, '');
  for (const pattern of FILLERS) out = out.replace(pattern, dropFiller);
  return out;
}

function formalize(text: string): string {
  let out = text;
  for (const [pattern, replacement] of COLLOQUIAL) out = out.replace(pattern, (match) => keepCase(match, replacement));
  return out.replace(new RegExp(`,?\\s*${LEFT}né${RIGHT}\\??`, 'giu'), '').replace(new RegExp(`,\\s*${LEFT}tipo${RIGHT},\\s*`, 'giu'), ', ');
}

/** Long sentences split at their own joints (", mas", ", porque", "; "). */
function splitLongSentences(text: string, maxWords = 22): string {
  return sentenceSpans(text)
    .map((sentence) => {
      if (sentence.words <= maxWords) return sentence.text;
      return sentence.text
        .replace(/;\s+/g, '. ')
        .replace(/,\s+mas\s+/gi, '. Mas ')
        .replace(/,\s+porque\s+/gi, '. Isso porque ')
        .replace(/,\s+pois\s+/gi, '. Isso porque ');
    })
    .join(' ');
}

export function rewrite(text: string, tone: RewriteTone): string {
  switch (tone) {
    case 'direct':
      return tidy(outsideQuotes(text, (part) => removeFillers(part).replace(/;\s+/g, '. ')));
    case 'didactic':
      return tidy(outsideQuotes(text, (part) => splitLongSentences(removeFillers(part))));
    case 'formal':
      return tidy(outsideQuotes(text, (part) => formalize(removeFillers(part))));
  }
}

/** Sentences worth keeping when shortening: the first, quotes, numbers and names carry the facts. */
function weight(sentence: string, index: number): number {
  let score = index === 0 ? 100 : 0;
  if (/[“"«]/.test(sentence)) score += 50;
  if (/\d/.test(sentence)) score += 10;
  score += (sentence.match(/\s\p{Lu}\p{Ll}+/gu) ?? []).length * 3;
  return score - countWords(sentence) * 0.1;
}

/** Shortens to about 70% of the words: fillers out, asides out, then the lightest sentences. */
export function shorten(text: string, ratio = 0.7): string {
  const target = Math.max(1, Math.floor(countWords(text) * ratio));
  let out = tidy(outsideQuotes(text, (part) => removeFillers(part).replace(/\s+—\s+[^—]+?\s+—\s+/g, ' ').replace(/\s*\([^)“"]*\)/g, '')));
  let sentences = sentenceSpans(out).map((sentence, index) => ({ text: sentence.text, index, weight: weight(sentence.text, index) }));
  while (countWords(out) > target && sentences.length > 1) {
    const lightest = sentences.slice(1).reduce((min, entry) => (entry.weight < min.weight ? entry : min));
    sentences = sentences.filter((entry) => entry !== lightest);
    out = sentences.map((entry) => entry.text).join(' ');
  }
  return tidy(out);
}

/** List items from a paragraph: one per sentence (two at least). */
export function toListItems(text: string): string[] {
  return sentenceSpans(text).map((sentence) => withoutFinalPeriod(sentence.text)).filter((item) => item.length > 0);
}

export function sameText(a: string, b: string): boolean {
  return a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
}
