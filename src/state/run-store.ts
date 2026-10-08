import type { RunId } from '../domain/ids.ts';
import type { RunEvent, RunFold } from '../domain/run-events.ts';
import { isRunActive } from '../domain/run.ts';
import type { Unsubscribe } from '../ports/common.ts';
import type { GenerationService, RunListener, RunMeta } from '../ports/generation.ts';
import { UNEXPECTED_ERROR } from './query-state.ts';
import type { QueryState } from './query-state.ts';
import type { Scheduler } from './query-store.ts';

/**
 * Live view of one generation run: attaches once (snapshot of steps + finished blocks), then
 * folds every live update. The domain `foldRun` stays the only interpreter: each update already
 * carries the folded state. Runs outside this session (after a reload) answer `unknown_run`;
 * their persisted outcome is part of the production read model instead.
 */

export type RunState = {
  meta: RunMeta;
  fold: RunFold;
  /** Still streaming in this session. */
  live: boolean;
  /** Last event applied (absent right after attaching). */
  lastEvent?: RunEvent;
};

export type RunEntry = {
  readonly runId: RunId;
  snapshot(): QueryState<RunState>;
  subscribe(listener: () => void): Unsubscribe;
  /**
   * Every live update (text deltas included), e.g. for the editor to stream text in place. An
   * update's `fold` is the full state, so a listener that joins late resyncs from it.
   */
  listen(listener: RunListener): Unsubscribe;
};

export type RunStore = {
  entry(runId: RunId): RunEntry;
  dispose(): void;
};

export type RunStoreOptions = {
  /** Unwatched runs are detached after this delay (default 30 s). */
  evictAfterMs?: number;
  /**
   * Text deltas re-render watching screens at most once per this window (default 100 ms); every
   * other event (steps, blocks, the end of the run) notifies at once. Listeners always get every
   * update, so the editor still streams word by word.
   */
  coalesceMs?: number;
  schedule?: Scheduler;
};

type Entry = RunEntry & {
  state: QueryState<RunState>;
  /** Pending coalesced notification of watchers. */
  cancelNotify: (() => void) | undefined;
  watchers: Set<() => void>;
  listeners: Set<RunListener>;
  attaching: boolean;
  detach: Unsubscribe | undefined;
  cancelEviction: (() => void) | undefined;
  evicted: boolean;
  retry: () => void;
};

const timerScheduler: Scheduler = (task, ms) => {
  const handle = setTimeout(task, ms);
  return () => clearTimeout(handle);
};

export function createRunStore(generation: Pick<GenerationService, 'attach'>, options: RunStoreOptions = {}): RunStore {
  const evictAfterMs = options.evictAfterMs ?? 30_000;
  const coalesceMs = options.coalesceMs ?? 100;
  const schedule = options.schedule ?? timerScheduler;
  const entries = new Map<RunId, Entry>();
  let disposed = false;

  function notify(entry: Entry): void {
    entry.cancelNotify?.();
    entry.cancelNotify = undefined;
    for (const watcher of [...entry.watchers]) watcher();
  }

  function emit(entry: Entry, next: QueryState<RunState>, coalesce = false): void {
    entry.state = next;
    if (!coalesce || coalesceMs <= 0) {
      notify(entry);
      return;
    }
    if (entry.cancelNotify) return;
    entry.cancelNotify = schedule(() => {
      entry.cancelNotify = undefined;
      if (!disposed) notify(entry);
    }, coalesceMs);
  }

  function attach(entry: Entry): void {
    if (disposed || entry.attaching || entry.detach) return;
    entry.attaching = true;
    Promise.resolve()
      .then(() => generation.attach(entry.runId))
      .then(
        (result) => {
          if (disposed || entry.evicted) return;
          if (!result.ok) {
            emit(entry, { status: 'error', data: undefined, error: { code: result.refusal.code, message: result.refusal.message }, retry: entry.retry });
            return;
          }
          const { meta, snapshot } = result.value;
          emit(entry, { status: 'ready', data: { meta, fold: snapshot, live: isRunActive(snapshot.run) }, error: undefined, retry: entry.retry });
          entry.detach = result.value.subscribe((update) => {
            const current = entry.state.data;
            if (current && update.fold.seq <= current.fold.seq) return;
            const data: RunState = { meta: update.meta, fold: update.fold, live: isRunActive(update.fold.run), lastEvent: update.event };
            emit(entry, { status: 'ready', data, error: undefined, retry: entry.retry }, update.event.type === 'text.delta');
            for (const listener of [...entry.listeners]) {
              try {
                listener(update);
              } catch {
                // A failing screen listener never stops the others.
              }
            }
          });
        },
        () => {
          if (!disposed && !entry.evicted) emit(entry, { status: 'error', data: entry.state.data, error: UNEXPECTED_ERROR, retry: entry.retry });
        },
      )
      .finally(() => {
        entry.attaching = false;
      });
  }

  function release(entry: Entry): void {
    if (entry.watchers.size > 0 || entry.listeners.size > 0 || entry.cancelEviction || disposed) return;
    entry.cancelEviction = schedule(() => {
      entry.cancelEviction = undefined;
      if (entry.watchers.size > 0 || entry.listeners.size > 0) return;
      entry.evicted = true;
      entry.detach?.();
      entry.detach = undefined;
      if (entries.get(entry.runId) === entry) entries.delete(entry.runId);
    }, evictAfterMs);
  }

  function retain(entry: Entry): void {
    entry.cancelEviction?.();
    entry.cancelEviction = undefined;
    if (entry.evicted && !disposed) {
      entry.evicted = false;
      if (!entries.has(entry.runId)) entries.set(entry.runId, entry);
    }
    if (entry.state.status !== 'ready') attach(entry);
  }

  function create(runId: RunId): Entry {
    const entry = {
      runId,
      watchers: new Set<() => void>(),
      listeners: new Set<RunListener>(),
      attaching: false,
      detach: undefined,
      cancelEviction: undefined,
      cancelNotify: undefined,
      evicted: false,
    } as unknown as Entry;
    entry.retry = () => {
      entry.detach?.();
      entry.detach = undefined;
      attach(entry);
    };
    entry.state = { status: 'loading', data: undefined, error: undefined, retry: entry.retry };
    entry.snapshot = () => entry.state;
    entry.subscribe = (watcher) => {
      entry.watchers.add(watcher);
      retain(entry);
      return () => {
        entry.watchers.delete(watcher);
        release(entry);
      };
    };
    entry.listen = (listener) => {
      entry.listeners.add(listener);
      retain(entry);
      return () => {
        entry.listeners.delete(listener);
        release(entry);
      };
    };
    return entry;
  }

  return {
    entry(runId) {
      const existing = entries.get(runId);
      if (existing) return existing;
      const entry = create(runId);
      if (!disposed) entries.set(runId, entry);
      return entry;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of entries.values()) {
        entry.cancelEviction?.();
        entry.cancelNotify?.();
        entry.detach?.();
      }
      entries.clear();
    },
  };
}
