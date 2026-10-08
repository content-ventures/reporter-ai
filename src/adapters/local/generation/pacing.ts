import type { Rng } from './random.ts';

/**
 * Latency model of the simulation: first token after 0.6–0.9 s, word-sized chunks at a natural
 * reading pace, non-writing steps of 0.8–2.5 s. Delays go through an injected `Sleep`, so tests
 * run instantly and deterministically.
 */

/** Waits `ms` (or less when the signal aborts). Never rejects. */
export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

export const realtimeSleep: Sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal.aborted || ms <= 0) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });

export type Pacing = {
  firstToken(): number;
  step(): number;
  /** Short pause between emitted items (source chips, slides, blocks). */
  beat(): number;
  chunkDelay(): number;
};

export function createPacing(rng: Rng, factor = 1): Pacing {
  const scaled = (min: number, max: number) => Math.round(rng.between(min, max) * factor);
  return {
    firstToken: () => scaled(600, 900),
    step: () => scaled(800, 2500),
    beat: () => scaled(120, 380),
    chunkDelay: () => scaled(30, 80),
  };
}

/**
 * Splits text into stream chunks of 1–3 words, each keeping its trailing whitespace, so the
 * concatenation of the chunks is exactly the text.
 */
export function chunkWords(text: string, rng: Rng): string[] {
  const tokens = text.match(/\S+\s*|\s+/g) ?? [];
  const chunks: string[] = [];
  let index = 0;
  while (index < tokens.length) {
    const size = rng.int(1, 3);
    chunks.push(tokens.slice(index, index + size).join(''));
    index += size;
  }
  return chunks;
}
