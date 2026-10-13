import type { RunId } from '../domain/ids.ts';
import type { RunUpdate } from '../ports/generation.ts';

/**
 * Bridge between `GenerationService.watch` and the store's record write path. Text deltas only
 * grow the streamed text, which every later event's fold already contains, so they are
 * coalesced: the latest delta of each run is applied after `flushMs` (keeping the persisted
 * stream snapshot fresh for reload recovery) or dropped when a structural event of the same run
 * arrives first. Every other event is applied at once and in order.
 */

export type Scheduler = (task: () => void, ms: number) => () => void;

export type RunSyncOptions = {
  /** Delay before a pending text delta reaches the store (default 500 ms). */
  flushMs?: number;
  schedule?: Scheduler;
};

export type RunSync = {
  push(update: RunUpdate): void;
  /** Applies pending deltas now (route change, `pagehide`, dispose). */
  flush(): void;
  /** Drops pending deltas and timers; later pushes are ignored. */
  dispose(): void;
};

const timerScheduler: Scheduler = (task, ms) => {
  const handle = setTimeout(task, ms);
  return () => clearTimeout(handle);
};

export function createRunSync(apply: (update: RunUpdate) => void, options: RunSyncOptions = {}): RunSync {
  const flushMs = options.flushMs ?? 500;
  const schedule = options.schedule ?? timerScheduler;
  const pending = new Map<RunId, RunUpdate>();
  let cancelTimer: (() => void) | undefined;
  let disposed = false;

  const safeApply = (update: RunUpdate) => {
    try {
      apply(update);
    } catch {
      // A failing write must never stop the stream; the next event carries the whole fold.
    }
  };

  const flush = () => {
    cancelTimer?.();
    cancelTimer = undefined;
    const updates = [...pending.values()];
    pending.clear();
    for (const update of updates) safeApply(update);
  };

  return {
    push(update) {
      if (disposed) return;
      const runId = update.meta.runId;
      if (update.event.type === 'text.delta') {
        pending.set(runId, update);
        cancelTimer ??= schedule(() => {
          cancelTimer = undefined;
          flush();
        }, flushMs);
        return;
      }
      pending.delete(runId);
      safeApply(update);
    },
    flush() {
      if (!disposed) flush();
    },
    dispose() {
      disposed = true;
      cancelTimer?.();
      cancelTimer = undefined;
      pending.clear();
    },
  };
}
