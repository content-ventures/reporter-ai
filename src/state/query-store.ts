import type { Result } from '../domain/result.ts';
import type { ChangeNotice, Unsubscribe } from '../ports/common.ts';
import { UNEXPECTED_ERROR } from './query-state.ts';
import type { QueryState } from './query-state.ts';

/**
 * Framework-free cache behind the data hooks (`useSyncExternalStore` reads `snapshot()`).
 * One entry per query key; an entry loads when a screen subscribes, refetches when a change
 * notice touches it while on screen (stale otherwise, refetched on the next subscribe), keeps
 * the same snapshot object while the answer is unchanged, and is evicted a while after the last
 * screen leaves. Fetches of one key never overlap, so answers can't arrive out of order.
 */

export type QuerySpec<C, T> = {
  /** Unique per query and arguments (e.g. `production:"prod-1"`). */
  key: string;
  fetch(context: C): Promise<Result<T, string>>;
  /** Whether a change makes the cached answer stale (`data` = last answer, if any). */
  affectedBy(notice: ChangeNotice, data: T | undefined): boolean;
};

export type QueryEntry<T> = {
  readonly key: string;
  /** Same object until the state changes (useSyncExternalStore contract). */
  snapshot(): QueryState<T>;
  /** Starts loading when needed; the listener runs after every state change. */
  subscribe(listener: () => void): Unsubscribe;
  refetch(): void;
};

export type QueryStore<C> = {
  entry<T>(spec: QuerySpec<C, T>): QueryEntry<T>;
  /** Marks affected entries stale and refetches those on screen (coalesced per microtask). */
  invalidate(notice: ChangeNotice): void;
  dispose(): void;
};

export type Scheduler = (task: () => void, ms: number) => () => void;

export type QueryStoreOptions = {
  /** Unwatched entries are dropped after this delay (default 60 s). */
  evictAfterMs?: number;
  schedule?: Scheduler;
};

type Entry<C, T> = QueryEntry<T> & {
  spec: QuerySpec<C, T>;
  state: QueryState<T>;
  listeners: Set<() => void>;
  stale: boolean;
  inflight: boolean;
  again: boolean;
  /** Serialized last answer, to keep the snapshot when a refetch returns the same data. */
  json: string | undefined;
  cancelEviction: (() => void) | undefined;
  evicted: boolean;
};

const timerScheduler: Scheduler = (task, ms) => {
  const handle = setTimeout(task, ms);
  return () => clearTimeout(handle);
};

function serialize(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

/**
 * @param context what `spec.fetch` receives (the runtime).
 * @param changes source of change notices; the store invalidates on each one.
 */
export function createQueryStore<C>(
  context: C,
  changes: (listener: (notice: ChangeNotice) => void) => Unsubscribe,
  options: QueryStoreOptions = {},
): QueryStore<C> {
  const evictAfterMs = options.evictAfterMs ?? 60_000;
  const schedule = options.schedule ?? timerScheduler;
  const entries = new Map<string, Entry<C, unknown>>();
  const queued = new Set<Entry<C, unknown>>();
  let flushQueued = false;
  let disposed = false;

  function emit<T>(entry: Entry<C, T>, next: QueryState<T>): void {
    entry.state = next;
    for (const listener of [...entry.listeners]) listener();
  }

  function settle<T>(entry: Entry<C, T>, result: Result<T, string>): void {
    if (result.ok) {
      const json = serialize(result.value);
      if (entry.state.status === 'ready' && json !== undefined && json === entry.json) return;
      entry.json = json;
      emit(entry, { status: 'ready', data: result.value, error: undefined, retry: entry.refetch });
      return;
    }
    const { code, message } = result.refusal;
    const current = entry.state;
    if (current.status === 'error' && current.data === undefined && current.error.code === code && current.error.message === message) return;
    entry.json = undefined;
    emit(entry, { status: 'error', data: undefined, error: { code, message }, retry: entry.refetch });
  }

  function fail<T>(entry: Entry<C, T>): void {
    const current = entry.state;
    if (current.status === 'error' && current.error === UNEXPECTED_ERROR) return;
    emit(entry, { status: 'error', data: current.data, error: UNEXPECTED_ERROR, retry: entry.refetch });
  }

  function load<T>(entry: Entry<C, T>): void {
    if (disposed) return;
    if (entry.inflight) {
      entry.again = true;
      return;
    }
    entry.inflight = true;
    entry.stale = false;
    Promise.resolve()
      .then(() => entry.spec.fetch(context))
      .then(
        (result) => {
          if (!disposed) settle(entry, result);
        },
        () => {
          if (!disposed) fail(entry);
        },
      )
      .finally(() => {
        entry.inflight = false;
        if (entry.again && !disposed) {
          entry.again = false;
          load(entry);
        }
      });
  }

  function flushQueue(): void {
    flushQueued = false;
    const pending = [...queued];
    queued.clear();
    for (const entry of pending) if (entry.listeners.size > 0) load(entry);
  }

  function enqueue(entry: Entry<C, unknown>): void {
    queued.add(entry);
    if (flushQueued) return;
    flushQueued = true;
    queueMicrotask(flushQueue);
  }

  function evict(entry: Entry<C, unknown>): void {
    entry.cancelEviction = undefined;
    if (entry.listeners.size > 0) return;
    entry.evicted = true;
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
  }

  function create<T>(spec: QuerySpec<C, T>): Entry<C, T> {
    const entry = {
      key: spec.key,
      spec,
      listeners: new Set<() => void>(),
      stale: true,
      inflight: false,
      again: false,
      json: undefined,
      cancelEviction: undefined,
      evicted: false,
    } as unknown as Entry<C, T>;
    entry.refetch = () => load(entry);
    entry.state = { status: 'loading', data: undefined, error: undefined, retry: entry.refetch };
    entry.snapshot = () => entry.state;
    entry.subscribe = (listener) => {
      if (entry.evicted && !disposed) {
        entry.evicted = false;
        if (!entries.has(entry.key)) entries.set(entry.key, entry as Entry<C, unknown>);
      }
      entry.cancelEviction?.();
      entry.cancelEviction = undefined;
      entry.listeners.add(listener);
      if (entry.stale) load(entry);
      return () => {
        entry.listeners.delete(listener);
        if (entry.listeners.size === 0 && !entry.cancelEviction && !disposed) {
          entry.cancelEviction = schedule(() => evict(entry as Entry<C, unknown>), evictAfterMs);
        }
      };
    };
    return entry;
  }

  const store: QueryStore<C> = {
    entry<T>(spec: QuerySpec<C, T>): QueryEntry<T> {
      const existing = entries.get(spec.key);
      if (existing) return existing as Entry<C, T>;
      const entry = create(spec);
      if (!disposed) entries.set(spec.key, entry as Entry<C, unknown>);
      return entry;
    },
    invalidate(notice) {
      if (disposed) return;
      for (const entry of entries.values()) {
        let affected = true;
        try {
          affected = entry.spec.affectedBy(notice, entry.state.data);
        } catch {
          // An unreadable answer is refetched rather than trusted.
        }
        if (!affected) continue;
        entry.stale = true;
        if (entry.listeners.size > 0) enqueue(entry);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      for (const entry of entries.values()) entry.cancelEviction?.();
      entries.clear();
      queued.clear();
    },
  };
  const unsubscribe = changes((notice) => store.invalidate(notice));
  return store;
}
