/**
 * Text measurement for slot fit. With a canvas the real font metrics are used; without one (Node
 * tests, SSR) widths are ESTIMATED from per-character proportions of a humanist sans (Inter).
 * Either way the result is labelled approximate: the final render may come from a vendor (D07).
 */

/** Measures the width of `text` in pixels for a given CSS font size and weight. */
export type MeasureText = (text: string, font: { family?: string; size: number; weight: number; italic?: boolean; tracking?: number }) => number;

const NARROW = new Set([...`iljtfIJ.,;:!'|·’‘ `]);
const SEMI_NARROW = new Set([...'rs()[]{}-"“”/']);
const WIDE = new Set([...'mwMW@%—']);
const DIGITS = /\p{Nd}/u;
const UPPER = /\p{Lu}/u;

function charEm(char: string): number {
  if (char === ' ') return 0.27;
  if (NARROW.has(char)) return 0.28;
  if (SEMI_NARROW.has(char)) return 0.38;
  if (WIDE.has(char)) return 0.86;
  if (DIGITS.test(char)) return 0.58;
  if (UPPER.test(char)) return 0.68;
  return 0.54;
}

/** Estimated width (no canvas): sum of character proportions × size, heavier weights a bit wider, plus letter spacing. */
export const estimateText: MeasureText = (text, font) => {
  let em = 0;
  let count = 0;
  for (const char of text) {
    em += charEm(char);
    count += 1;
  }
  const weight = font.weight >= 700 ? 1.06 : font.weight >= 600 ? 1.04 : font.weight >= 500 ? 1.02 : 1;
  return em * font.size * weight + (font.tracking ?? 0) * count;
};

/**
 * Greedy word wrap. A word wider than the box is broken by characters (it would overflow in
 * any renderer, so the fit reports it).
 */
export function wrapLines(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (measure(word) <= maxWidth) {
        line = word;
        continue;
      }
      let piece = '';
      for (const char of word) {
        if (piece && measure(piece + char) > maxWidth) {
          lines.push(piece);
          piece = '';
        }
        piece += char;
      }
      line = piece;
    }
    if (line || words.length === 0) lines.push(line);
  }
  return lines.length > 0 ? lines : [''];
}

/** Last visible line ellipsised to fit the width. */
export function ellipsize(line: string, maxWidth: number, measure: (text: string) => number): string {
  if (measure(`${line}…`) <= maxWidth) return `${line}…`;
  let cut = line;
  while (cut.length > 0 && measure(`${cut}…`) > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}
