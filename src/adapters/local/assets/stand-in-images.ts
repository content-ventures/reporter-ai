import { imageDescription } from '../../../domain/image-generation.ts';
import { ok, refuse } from '../../../domain/result.ts';
import type { ImageGenerator } from '../../../ports/image-generation.ts';
import { fetchBlob } from './asset-store.ts';

/**
 * "Gerar com IA" in the simulation: there is no provider, so after a short wait each request
 * answers with the next of the example's images (served by the app), and "Gerar de novo" brings
 * another. The flow (description, preview, keep, article illustrated) reads as in production.
 */

export type StandInOptions = {
  /** Addresses of the example's images, in the order they answer. */
  samples: readonly string[];
  /** Reads an image's bytes; default `fetch` of its address (undefined where that fails). */
  fetchSample?: (src: string) => Promise<Blob | undefined>;
  /** How long a "generation" takes (default 900 ms). */
  delayMs?: number;
  /** Waits that long; tests inject an instant one. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

const FAILED = 'Não foi possível gerar a imagem. Tente de novo.';

function pause(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

export function createStandInImageGenerator(options: StandInOptions): ImageGenerator {
  const fetchSample = options.fetchSample ?? fetchBlob;
  const sleep = options.sleep ?? pause;
  let next = 0;
  return {
    async generate(input, signal) {
      if (!imageDescription(input.prompt)) return refuse('empty', 'Descreva a imagem.');
      const src = options.samples.length ? options.samples[next++ % options.samples.length] : undefined;
      await sleep(options.delayMs ?? 900, signal ?? new AbortController().signal);
      if (!src || signal?.aborted) return refuse('unavailable', FAILED);
      const file = await fetchSample(src).catch(() => undefined);
      return file ? ok({ file }) : refuse('unavailable', FAILED);
    },
  };
}
