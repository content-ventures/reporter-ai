import { countWords } from '../../domain/index.ts';

/**
 * Renders interview turns as a WebVTT subtitle file (one cue per sentence, `<v Nome>` voice
 * tags), the way podcast tools export captions. Exercises the .vtt path of the parser.
 */

export type Turn = readonly [speaker: string, text: string];

function clock(totalMs: number): string {
  const ms = Math.round(totalMs);
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`;
}

function sentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+["”»]?(?:\s+|$)|[^.!?]+$/g)?.map((part) => part.trim()).filter(Boolean) ?? [text];
}

export function toVtt(turns: readonly Turn[], options: { startMs?: number; msPerWord?: number; pauseMs?: number } = {}): string {
  const msPerWord = options.msPerWord ?? 380;
  const pauseMs = options.pauseMs ?? 600;
  let cursor = options.startMs ?? 2_000;
  const cues: string[] = ['WEBVTT', ''];
  for (const [speaker, text] of turns) {
    for (const sentence of sentences(text)) {
      const end = cursor + Math.max(1, countWords(sentence)) * msPerWord;
      cues.push(`${clock(cursor)} --> ${clock(end)}`, `<v ${speaker}>${sentence}`, '');
      cursor = end + 200;
    }
    cursor += pauseMs;
  }
  return cues.join('\n');
}
