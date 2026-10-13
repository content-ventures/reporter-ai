/** Word and character counting and reading time (pt-BR editorial convention: 200 words per minute). */

export const WORDS_PER_MINUTE = 200;

/** A word is a run of letters/digits, allowing inner apostrophes and hyphens ("d'água", "bem-vindo"). */
const WORD = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

export function words(text: string): string[] {
  return text.match(WORD) ?? [];
}

export function countWords(text: string): number {
  let count = 0;
  for (const match of text.matchAll(WORD)) {
    if (match[0]) count += 1;
  }
  return count;
}

export function readingMinutes(wordCount: number): number {
  if (wordCount <= 0) return 0;
  return Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE));
}

/**
 * The lauda count: characters WITH spaces, Unicode-normalised (NFC), one per code point (an
 * accented letter is one, however it was typed), line breaks left out. Same rule as the DS
 * `textStats().characters`.
 */
export function countCharacters(text: string): number {
  return [...text.normalize('NFC').replace(/[\r\n]/g, '')].length;
}

export type TextStats = {
  words: number;
  /** Characters with spaces, without line breaks (`countCharacters`). */
  characters: number;
  readingMinutes: number;
};

export function textStats(text: string): TextStats {
  const wordCount = countWords(text);
  return {
    words: wordCount,
    characters: countCharacters(text),
    readingMinutes: readingMinutes(wordCount),
  };
}
