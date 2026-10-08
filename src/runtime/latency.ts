import { stableStringify } from '../domain/text/hash.ts';
import type { ProductionQueries } from '../ports/production-queries.ts';

/**
 * First-load latency of the simulated runtime: the first read of each query (method + arguments)
 * waits 150–300 ms, like a network round trip, so loading skeletons and error states exist from
 * day one. Refetches after a change answer at once, as a warm cache would.
 */

export type LatencyOptions = {
  minMs: number;
  maxMs: number;
  /** Uniform number in [0, 1); injectable for tests. */
  random?: () => number;
  /** Waits `ms`; injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
};

export const DEFAULT_LATENCY: LatencyOptions = { minMs: 150, maxMs: 300 };

const timerSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type QueryMethod = Exclude<keyof ProductionQueries, 'subscribe'>;

/**
 * Every read of the port. A `Record` on purpose: a query added to `ProductionQueries` and not
 * listed here is a compile error (a missing one left `approvals` undefined in the browser).
 */
const READS: Readonly<Record<QueryMethod, true>> = {
  list: true,
  get: true,
  overview: true,
  activity: true,
  people: true,
  draft: true,
  version: true,
  compare: true,
  source: true,
  review: true,
  delivery: true,
  approvals: true,
};

export function withFirstLoadLatency(queries: ProductionQueries, options: LatencyOptions = DEFAULT_LATENCY): ProductionQueries {
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? timerSleep;
  const seen = new Set<string>();
  const span = Math.max(0, options.maxMs - options.minMs);

  const delayed = <A extends unknown[], R>(method: QueryMethod, read: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      let count = args.length;
      while (count > 0 && args[count - 1] === undefined) count -= 1;
      const key = `${method}:${stableStringify(args.slice(0, count))}`;
      if (!seen.has(key)) {
        seen.add(key);
        await sleep(Math.round(options.minMs + random() * span));
      }
      return read(...args);
    };

  const wrapped: Record<string, unknown> = { subscribe: queries.subscribe.bind(queries) };
  for (const method of Object.keys(READS) as QueryMethod[]) {
    const read = queries[method] as (...args: unknown[]) => Promise<unknown>;
    wrapped[method] = delayed(method, read.bind(queries));
  }
  return wrapped as unknown as ProductionQueries;
}

/**
 * The same first-read latency for any read port: `methods` wait 150–300 ms on their first call
 * per arguments; every other member is passed through untouched.
 */
export function withFirstReadLatency<T extends object>(target: T, methods: readonly (keyof T & string)[], options: LatencyOptions = DEFAULT_LATENCY): T {
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? timerSleep;
  const seen = new Set<string>();
  const span = Math.max(0, options.maxMs - options.minMs);
  const wrapped: Record<string, unknown> = {};
  for (const [name, member] of Object.entries(target)) {
    wrapped[name] = typeof member === 'function' ? (member as (...args: unknown[]) => unknown).bind(target) : member;
  }
  for (const method of methods) {
    const read = (target[method] as (...args: unknown[]) => Promise<unknown>).bind(target);
    wrapped[method] = async (...args: unknown[]) => {
      let count = args.length;
      while (count > 0 && args[count - 1] === undefined) count -= 1;
      const key = `${method}:${stableStringify(args.slice(0, count))}`;
      if (!seen.has(key)) {
        seen.add(key);
        await sleep(Math.round(options.minMs + random() * span));
      }
      return read(...args);
    };
  }
  return wrapped as T;
}
