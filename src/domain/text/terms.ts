/**
 * "Corrigir termo" (Nova produção, Material): a name the transcription misheard ("Q Show") is replaced
 * by the right one ("Aquishow") across the transcript before the production exists. Whole words only,
 * in any case, any run of spaces or a line break between the words of the term. Times are never
 * touched: SRT/VTT cue numbers and timestamp lines, and "[00:04:12]" stamps inside the speech, so the
 * parser still reads every line with its time and speaker.
 */
import { detectTranscriptFormat, parseTranscript } from './transcript-parse.ts';

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/**
 * A term as whole words. `crossLines`: a cue of an SRT/VTT file may wrap one sentence over two lines;
 * in "Nome: fala" text every line is its own turn, and a match across lines would swallow a label.
 * `exact`: the case as typed (the right name), not any case (the misheard one).
 */
function termPattern(term: string, crossLines = false, exact = false): RegExp | undefined {
  const words = term.normalize('NFC').trim().split(/\s+/u).filter(Boolean);
  if (!words.length) return undefined;
  // A combining accent belongs to its word: "Jose" never matches the start of a decomposed "José".
  // Inside a cue a sentence wraps over one line break; a blank line separates cues and is never crossed.
  const space = crossLines ? '(?:[^\\S\\n]+|[^\\S\\n]*\\n[^\\S\\n]*)' : '[^\\S\\n]+';
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${words.map(escape).join(space)}(?![\\p{L}\\p{M}\\p{N}])`, exact ? 'gu' : 'giu');
}
const crossesLines = (text: string) => ['srt', 'vtt'].includes(detectTranscriptFormat(text));

/** A cue number, a VTT header or a timestamp line of an SRT/VTT file: never part of the speech. */
const timingLine = (line: string) => /^\s*\d+\s*$/u.test(line) || line.includes('-->') || /^\s*WEBVTT\b/u.test(line);
/** A time written inside the speech: "[00:04:12]", "(04:12)", "04:12" or "00:04:12". */
const STAMP = /\[\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?\]|\(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?\)|(?<![\d:])\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?(?![\d:])/gu;

/** Applies `edit` to the speech only: runs of lines between timing lines, outside the stamps in them. */
function editSpeech(text: string, edit: (speech: string) => string): string {
  const lines = text.split('\n'), out: string[] = [];
  let block: string[] = [];
  const flush = () => {
    if (!block.length) return;
    const speech = block.join('\n').normalize('NFC');
    let result = '', last = 0;
    for (const stamp of speech.matchAll(STAMP)) {
      result += edit(speech.slice(last, stamp.index)) + stamp[0];
      last = stamp.index + stamp[0].length;
    }
    out.push(result + edit(speech.slice(last)));
    block = [];
  };
  for (const line of lines) {
    if (timingLine(line)) { flush(); out.push(line); } else block.push(line);
  }
  flush();
  return out.join('\n');
}

/**
 * Where `from` occurs as a whole word but not inside a whole occurrence of `to`: fixing "Rafael" to
 * "Rafael Dias" leaves an existing "Rafael Dias" as it is.
 */
function occurrences(speech: string, pattern: RegExp, to: string, crossLines: boolean): number[] {
  const right = termPattern(to, crossLines, true), kept: [number, number][] = [];
  if (right) for (const match of speech.matchAll(right)) kept.push([match.index, match.index + match[0].length]);
  // Skipped when already written as the right name, or inside a longer right name: shortening
  // "Lucas Ferraz" to "Lucas" still applies.
  const exact = to.normalize('NFC').trim().replace(/\s+/gu, ' ');
  return [...speech.matchAll(pattern)].filter(match => match[0].replace(/\s+/gu, ' ') !== exact && !kept.some(([start, end]) =>
    match.index >= start && match.index + match[0].length <= end && end - start > match[0].length)).map(match => match.index);
}

/** How many times the term appears in the speech of a transcript, not counting the right name itself. */
export function termOccurrences(text: string, term: string, to = ''): number {
  const cross = crossesLines(text), pattern = termPattern(term, cross);
  if (!pattern) return 0;
  let count = 0;
  editSpeech(text, speech => { count += occurrences(speech, pattern, to, cross).length; return speech; });
  return count;
}

/** The transcript with every whole-word occurrence of `from` written as `to`, and how many changed. */
export function replaceTerm(text: string, from: string, to: string): { text: string; count: number } {
  const cross = crossesLines(text), pattern = termPattern(from, cross), replacement = to.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!pattern || !replacement) return { text, count: 0 };
  let count = 0;
  const edited = editSpeech(text, speech => {
    const at = new Set(occurrences(speech, pattern, replacement, cross));
    return speech.replace(pattern, (found: string, offset: number) => {
      if (!at.has(offset)) return found;
      count++;
      return replacement;
    });
  });
  return { text: count ? edited : text, count };
}

/**
 * A correction for the Material: the replacement, refused when it would change how the material is
 * read, not only its words. A speaker name the label rules do not accept ("Rafael du Pont:") would
 * hand that speaker's lines to the previous one; then the
 * name is corrected in "Falantes" instead.
 */
export type TermCorrection = { text: string; count: number; refused?: undefined } | { refused: 'structure'; count: number };

export function correctTerm(text: string, from: string, to: string): TermCorrection {
  const result = replaceTerm(text, from, to);
  if (!result.count) return result;
  // Who says each word, in order, leaving out the words of the term itself, which are what changes.
  // Stretches may regroup and a split name may stay as it was; no other word may change speaker, and
  // no label, identifier or time may turn into speech or vanish from it.
  const plain = (word: string) => word.normalize('NFC').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{M}\p{N}]/gu, '');
  const changing = new Set(`${from} ${to}`.split(/\s+/u).map(plain).filter(Boolean));
  const said = (raw: string, rename: boolean) => parseTranscript(raw).segments.flatMap(segment => {
    const speaker = segment.speaker === undefined ? '' : (rename ? replaceTerm(segment.speaker, from, to).text : segment.speaker).normalize('NFC');
    return segment.text.split(/\s+/u).filter(word => plain(word) && !changing.has(plain(word))).map(word => `${speaker}\u0000${word.normalize('NFC')}`);
  });
  const kept = parseTranscript(text).format === parseTranscript(result.text).format
    && JSON.stringify(said(text, true)) === JSON.stringify(said(result.text, false));
  return kept ? result : { refused: 'structure', count: result.count };
}
