import { fnv1a64 } from '../../../domain/text/hash.ts';

/** Seeded PRNG (mulberry32): same seed → same pacing and the same tie-breaks, run after run. */
export type Rng = {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** Uniform float in [min, max). */
  between(min: number, max: number): number;
};

export function createRng(seed: string): Rng {
  let state = parseInt(fnv1a64(seed).slice(8), 16) >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    between: (min, max) => min + next() * (max - min),
  };
}
