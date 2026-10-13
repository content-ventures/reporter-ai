import type { Unsubscribe } from '../ports/common.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { QueryError } from './query-state.ts';
import { createQueryStore } from './query-store.ts';
import type { QueryStore, QueryStoreOptions, Scheduler } from './query-store.ts';
import { createRunStore } from './run-store.ts';
import type { RunStore, RunStoreOptions } from './run-store.ts';

/**
 * Owns the client runtime and its caches. Nothing is created during render (SSR-safe): the
 * provider calls `start()` from an effect. `release()` only schedules disposal, so React's
 * StrictMode remount (effect → cleanup → effect) keeps the same runtime and its live runs.
 */

export type RuntimeHolderState =
  | { status: 'idle' }
  | { status: 'ready'; runtime: Runtime; queries: QueryStore<Runtime>; runs: RunStore }
  | { status: 'error'; error: QueryError };

/** `empty`: "Começar vazio" (team and templates only, no productions). */
export type RuntimeFactory = (options: { reset: boolean; empty?: boolean }) => Runtime;

export type RuntimeHolder = {
  /** Same object until the state changes (useSyncExternalStore contract). */
  get(): RuntimeHolderState;
  subscribe(listener: () => void): Unsubscribe;
  /** Creates the runtime unless one exists; cancels a pending release. */
  start(options?: { reset?: boolean }): void;
  /** Disposes the runtime after a short delay unless `start()` is called again. */
  release(): void;
  /** "Restaurar exemplo": disposes the runtime and reopens the fixtures (`empty`: "Começar vazio"). */
  reset(options?: { empty?: boolean }): void;
  /** The current runtime, waiting for `start()` when needed. */
  whenReady(): Promise<Runtime>;
  /** Writes pending changes now (route change, `pagehide`). */
  flush(): void;
};

export type RuntimeHolderOptions = {
  schedule?: Scheduler;
  /** Delay before a released runtime is disposed (default 1 s). */
  releaseAfterMs?: number;
  queries?: QueryStoreOptions;
  runs?: RunStoreOptions;
};

export const IDLE: RuntimeHolderState = Object.freeze({ status: 'idle' });

export const RUNTIME_ERROR: QueryError = Object.freeze({
  code: 'runtime_unavailable',
  message: 'Não foi possível abrir o espaço de trabalho neste navegador. Recarregue a página.',
});

const timerScheduler: Scheduler = (task, ms) => {
  const handle = setTimeout(task, ms);
  return () => clearTimeout(handle);
};

export function createRuntimeHolder(factory: RuntimeFactory, options: RuntimeHolderOptions = {}): RuntimeHolder {
  const schedule = options.schedule ?? timerScheduler;
  const releaseAfterMs = options.releaseAfterMs ?? 1000;
  const listeners = new Set<() => void>();
  let state: RuntimeHolderState = IDLE;
  let cancelRelease: (() => void) | undefined;
  let waiters: { resolve: (runtime: Runtime) => void; reject: (error: unknown) => void }[] = [];

  function set(next: RuntimeHolderState): void {
    state = next;
    if (next.status !== 'idle') {
      const pending = waiters;
      waiters = [];
      for (const waiter of pending) {
        if (next.status === 'ready') waiter.resolve(next.runtime);
        else waiter.reject(next.error);
      }
    }
    for (const listener of [...listeners]) listener();
  }

  function teardown(): void {
    if (state.status !== 'ready') return;
    const { runtime, queries, runs } = state;
    queries.dispose();
    runs.dispose();
    runtime.dispose();
  }

  function create(reset: boolean, empty = false): void {
    try {
      const runtime = factory(empty ? { reset, empty } : { reset });
      const queries = createQueryStore<Runtime>(runtime, (listener) => runtime.subscribe(listener), options.queries);
      const runs = createRunStore(runtime.generation, options.runs);
      set({ status: 'ready', runtime, queries, runs });
    } catch {
      set({ status: 'error', error: RUNTIME_ERROR });
    }
  }

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start(startOptions = {}) {
      cancelRelease?.();
      cancelRelease = undefined;
      if (state.status !== 'idle') return;
      create(startOptions.reset === true);
    },
    release() {
      if (cancelRelease || state.status === 'idle') return;
      cancelRelease = schedule(() => {
        cancelRelease = undefined;
        teardown();
        set(IDLE);
      }, releaseAfterMs);
    },
    reset(resetOptions = {}) {
      cancelRelease?.();
      cancelRelease = undefined;
      teardown();
      create(true, resetOptions.empty === true);
    },
    whenReady() {
      if (state.status === 'ready') return Promise.resolve(state.runtime);
      if (state.status === 'error') return Promise.reject(state.error);
      return new Promise<Runtime>((resolve, reject) => {
        waiters.push({ resolve, reject });
      });
    },
    flush() {
      if (state.status === 'ready') state.runtime.flush();
    },
  };
}
