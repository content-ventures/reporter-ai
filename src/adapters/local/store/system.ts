import type { IsoDateTime } from '../../../domain/ids.ts';
import type { Clock, IdGenerator } from '../../../ports/system.ts';

/**
 * Local Clock and IdGenerator. Ids never depend on `crypto.randomUUID` (missing in insecure
 * contexts such as a LAN preview over http): a per-load salt from `getRandomValues` (or a
 * time-based fallback) plus a counter keeps ids unique across reloads of a persisted workspace.
 */

export function systemClock(): Clock {
  return { now: () => new Date().toISOString() };
}

export type ManualClock = Clock & {
  advance(ms: number): void;
  set(instant: IsoDateTime): void;
};

/** Deterministic clock for tests and scripted demos. */
export function manualClock(start: IsoDateTime): ManualClock {
  let time = Date.parse(start);
  if (!Number.isFinite(time)) throw new Error(`Invalid start instant: ${start}`);
  return {
    now: () => new Date(time).toISOString(),
    advance: (ms) => {
      time += ms;
    },
    set: (instant) => {
      const next = Date.parse(instant);
      if (Number.isFinite(next)) time = next;
    },
  };
}

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomSalt(length: number): string {
  const bytes = new Uint8Array(length);
  const crypto = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (crypto?.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    let seed = Date.now() ^ (Math.floor(Math.random() * 0x7fffffff) >>> 0);
    for (let index = 0; index < length; index += 1) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      bytes[index] = seed & 0xff;
    }
  }
  return [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join('');
}

/** `ver-k3x9a-1c`: prefix, per-load salt, base-36 counter. */
export function createIdGenerator(options: { salt?: string } = {}): IdGenerator {
  const salt = options.salt ?? randomSalt(5);
  let counter = 0;
  return {
    next: (prefix) => {
      counter += 1;
      return `${prefix}-${salt}-${counter.toString(36)}`;
    },
  };
}

/** `ver-1`, `ver-2`…: deterministic ids for tests. */
export function sequentialIds(): IdGenerator {
  let counter = 0;
  return {
    next: (prefix) => {
      counter += 1;
      return `${prefix}-${counter}`;
    },
  };
}
