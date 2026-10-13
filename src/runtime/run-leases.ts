import type { RunId } from '../domain/ids.ts';
import type { RuntimeStorage } from './runtime.ts';

/**
 * Who drives each live run of the simulated generation, shared by the tabs of this browser (A04).
 * The simulation runs in the page, so a reload or a new tab would otherwise find runs "nobody
 * drives" and close them as "interrompida" — even a run another tab is still writing. Each tab
 * renews a lease per run it drives (one localStorage key per run, so tabs never overwrite each
 * other's leases); a tab that finds a run whose lease is gone, stale, its own (the same tab after
 * a reload, `tab` lives in sessionStorage) or left behind by a tab that closed, claims it,
 * confirms the claim a moment later (two tabs never both win) and continues the run in place.
 */

export const LEASE_PREFIX = 'reporter:run-lease:v1:';

type Lease = { tab: string; at: number; leaving?: true };

export type RunLeasesOptions = {
  storage: RuntimeStorage;
  /** This tab, stable across its reloads. */
  tab: string;
  /** Wall clock in ms (leases compare times across tabs). */
  now: () => number;
  /** A lease not renewed for this long belongs to a tab that froze or closed. */
  staleMs?: number;
  /** A tab that left (reload, close) has this long to come back for its runs. */
  graceMs?: number;
};

export type RunLeases = {
  /** Renews this tab's leases for the runs it drives and drops the ones it no longer drives. */
  beat(runIds: readonly RunId[]): void;
  /** May this tab take the run now: no lease, its own, a stale one or one its tab left. */
  free(runId: RunId): boolean;
  /** Writes this tab's claim; the returned check says, later, whether the claim held. */
  claim(runId: RunId): () => boolean;
  /** Gives a run up (it ended, or this tab could not continue it). */
  release(runId: RunId): void;
  /** The page is going away: other tabs may take this tab's runs after the grace period. */
  leave(): void;
};

export const DEFAULT_STALE_MS = 15_000;
export const DEFAULT_GRACE_MS = 3_000;

export function createRunLeases(options: RunLeasesOptions): RunLeases {
  const { storage, tab, now } = options;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  const held = new Set<RunId>();
  const key = (runId: RunId) => `${LEASE_PREFIX}${runId}`;

  const read = (runId: RunId): Lease | undefined => {
    try {
      const raw = storage.getItem(key(runId));
      if (!raw) return undefined;
      const lease = JSON.parse(raw) as Partial<Lease>;
      return typeof lease.tab === 'string' && typeof lease.at === 'number' ? (lease as Lease) : undefined;
    } catch {
      return undefined;
    }
  };
  const write = (runId: RunId, lease: Lease) => {
    try {
      storage.setItem(key(runId), JSON.stringify(lease));
    } catch {
      // A full storage only costs the coordination: this tab keeps driving its runs.
    }
  };
  const remove = (runId: RunId) => {
    try {
      storage.removeItem(key(runId));
    } catch {
      // Same as above.
    }
  };

  const free = (runId: RunId) => {
    const lease = read(runId);
    if (!lease || lease.tab === tab) return true;
    const age = now() - lease.at;
    return age > (lease.leaving ? graceMs : staleMs);
  };

  return {
    beat(runIds) {
      const driving = new Set(runIds);
      for (const runId of held) {
        if (!driving.has(runId)) {
          if (read(runId)?.tab === tab) remove(runId);
          held.delete(runId);
        }
      }
      const at = now();
      for (const runId of driving) {
        held.add(runId);
        write(runId, { tab, at });
      }
    },
    free,
    claim(runId) {
      if (!free(runId)) return () => false;
      // Not `held` yet: the lease becomes a renewed one once this tab drives the run.
      write(runId, { tab, at: now() });
      return () => read(runId)?.tab === tab;
    },
    release(runId) {
      held.delete(runId);
      if (read(runId)?.tab === tab) remove(runId);
    },
    leave() {
      const at = now();
      for (const runId of held) write(runId, { tab, at, leaving: true });
    },
  };
}
