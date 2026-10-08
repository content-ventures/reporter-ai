import { countWords } from '../../../domain/text/stats.ts';

/**
 * Sentence and word-boundary helpers for the extractive simulation. Offsets index the original
 * text, so every excerpt can be cited back with an exact segment range (`SourceRef.locator`).
 */

export type Span = { from: number; to: number; text: string; words: number };

const BOUNDARY = /[.!?…]+["'”»)]*(?=\s|$)/g;
/** Abbreviations and initials that end with a dot without ending the sentence. */
const ABBREVIATION = /(?:^|[\s(])(?:sr|sra|srta|dr|dra|prof|profa|av|etc|p|pág|nº|n|vol|cap|art|ex|obs|[A-ZÀ-Ý])\.$/i;

function span(text: string, from: number, to: number): Span | undefined {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(text[start])) start += 1;
  while (end > start && /\s/.test(text[end - 1])) end -= 1;
  if (start >= end) return undefined;
  const slice = text.slice(start, end);
  return { from: start, to: end, text: slice, words: countWords(slice) };
}

/** Sentences of a text with their offsets (whitespace trimmed, nothing else changed). */
export function sentenceSpans(text: string): Span[] {
  const spans: Span[] = [];
  let start = 0;
  for (const match of text.matchAll(BOUNDARY)) {
    const end = (match.index ?? 0) + match[0].length;
    if (match[0] === '.' && ABBREVIATION.test(text.slice(Math.max(0, end - 8), end))) continue;
    const found = span(text, start, end);
    if (found) spans.push(found);
    start = end;
  }
  const rest = span(text, start, text.length);
  if (rest) spans.push(rest);
  return spans;
}

/**
 * Cuts `text` to at most `maxChars` at a word boundary. Returns the kept prefix (no trailing
 * space or dangling punctuation) and whether it was cut.
 */
export function cutAtWord(text: string, maxChars: number): { text: string; cut: boolean } {
  const clean = text.trim();
  if (clean.length <= maxChars) return { text: clean, cut: false };
  const slice = clean.slice(0, maxChars + 1);
  const lastSpace = slice.lastIndexOf(' ');
  const kept = (lastSpace > 0 ? slice.slice(0, lastSpace) : clean.slice(0, maxChars)).replace(/[\s,;:–—-]+$/, '');
  return { text: kept, cut: true };
}

/** Cuts to at most `maxWords` words at a word boundary. */
export function cutWords(text: string, maxWords: number): { text: string; cut: boolean } {
  const parts = text.trim().split(/(\s+)/);
  let count = 0;
  let end = 0;
  for (let index = 0; index < parts.length; index += 1) {
    if (!/\S/.test(parts[index])) continue;
    count += 1;
    if (count > maxWords) break;
    end = index + 1;
  }
  const kept = parts.slice(0, end).join('').replace(/[\s,;:–—-]+$/, '');
  return { text: kept, cut: kept.length < text.trim().length };
}

/** Fits text into a character budget: whole sentences first, then a word-boundary cut with "…". */
export function fitText(text: string, maxChars: number): string {
  const clean = text.trim();
  if (clean.length <= maxChars) return clean;
  let kept = '';
  for (const sentence of sentenceSpans(clean)) {
    const next = kept ? `${kept} ${sentence.text}` : sentence.text;
    if (next.length > maxChars) break;
    kept = next;
  }
  if (kept) return kept;
  const cut = cutAtWord(clean, Math.max(1, maxChars - 1));
  return cut.cut ? `${cut.text}…` : cut.text;
}

export function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1);
}

/** Drops a final period (titles, list items, quotes inside attributions); keeps ? and !. */
export function withoutFinalPeriod(text: string): string {
  return text.trim().replace(/\.+$/, '').trimEnd();
}
