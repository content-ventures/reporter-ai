/**
 * "Corrigir termo" (Nova produção, Material): a name the transcription misheard ("Q Show") is replaced
 * by the right one ("Aquishow") across the transcript before the production exists. Whole words only,
 * in any case, any run of spaces between the words of the term. The cue numbers and timestamp lines
 * of an SRT are never touched, so the times stay intact.
 */
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

function termPattern(term: string): RegExp | undefined {
  const words = term.trim().split(/\s+/u).filter(Boolean);
  if (!words.length) return undefined;
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.map(escape).join('\\s+')}(?![\\p{L}\\p{N}])`, 'giu');
}

/** A cue number or timestamp line of an SRT/VTT file: never part of the speech. */
const timingLine = (line: string) => /^\s*\d+\s*$/u.test(line) || line.includes('-->');

/** How many times the term appears in the speech of a transcript. */
export function termOccurrences(text: string, term: string): number {
  const pattern = termPattern(term);
  if (!pattern) return 0;
  return text.split('\n').filter(line => !timingLine(line)).reduce((count, line) => count + (line.match(pattern)?.length ?? 0), 0);
}

/** The transcript with every whole-word occurrence of `from` written as `to`, and how many changed. */
export function replaceTerm(text: string, from: string, to: string): { text: string; count: number } {
  const pattern = termPattern(from), replacement = to.trim();
  if (!pattern || !replacement) return { text, count: 0 };
  let count = 0;
  const lines = text.split('\n').map(line => timingLine(line) ? line : line.replace(pattern, () => { count++; return replacement; }));
  return { text: lines.join('\n'), count };
}
