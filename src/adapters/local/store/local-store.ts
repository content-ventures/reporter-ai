import type { ActivityEvent } from '../../../domain/activity.ts';
import type { ActorId, PieceId, ProductionId } from '../../../domain/ids.ts';
import type { WorkingDraft } from '../../../domain/piece.ts';
import type { CommandContext, Result } from '../../../domain/result.ts';
import type { ChangeListener, ChangeNotice, ChangeScope, Unsubscribe } from '../../../ports/common.ts';
import type { SaveState } from '../../../ports/save-status.ts';
import type { Clock, IdGenerator } from '../../../ports/system.ts';
import { clearSnapshot, compactState, readSnapshot, readWriter, writeDraftSlot, writeSnapshot } from './snapshot.ts';
import type { LoadIssue } from './snapshot.ts';
import { locatePiece, normalizeSeed } from './state.ts';
import type { StoreSeed, StoreState } from './state.ts';
import { SAVE_ERROR_MESSAGES, storageErrorCode } from './storage.ts';
import type { KeyValueStorage } from './storage.ts';

/**
 * The simulated workspace: immutable state + semantic activity log + persistence. All writes go
 * through `transact`, so a refused change never touches state (contract: failure preserves
 * input) and every accepted change notifies subscribers exactly once.
 */

/** Activity to log; the store stamps id, time, workspace and actor. */
export type ActivityDraft = Omit<ActivityEvent, 'id' | 'at' | 'workspaceId' | 'actorId'> & { actorId?: ActorId };

/**
 * How a change is persisted: `full` writes the snapshot now; `deferred` coalesces (stream
 * progress); `draft` writes only the overwritten draft slot (autosave); `none` skips.
 */
export type PersistMode = 'full' | 'deferred' | { draft: PieceId } | 'none';

export type Change<T> = {
  state: StoreState;
  value: T;
  productionIds?: ProductionId[];
  activity?: ActivityDraft[];
  persist?: PersistMode;
  scope?: ChangeScope;
  /** Internal bookkeeping only (e.g. a stream snapshot): no notification. */
  silent?: boolean;
};

/** Return type of a transaction body: the next state plus the command's value, or a refusal. */
export type Tx<T, C extends string> = Result<Change<T>, C>;

export type Scheduler = (task: () => void, ms: number) => () => void;

export type LocalStoreOptions = {
  /** Fresh fixture state (called on first load and on reset). */
  seed: () => StoreSeed;
  clock: Clock;
  ids: IdGenerator;
  /** Omit for memory-only mode (SSR, tests without persistence). */
  storage?: KeyValueStorage;
  /** `?reset=1`: drop the saved workspace and start again from fixtures. */
  reset?: boolean;
  /** Delay for coalesced writes (default 400 ms). */
  deferredWriteMs?: number;
  scheduler?: Scheduler;
  /** Id of this tab in the writer stamp (default: a new id). */
  tabId?: string;
};

export type LoadReport = { source: 'seed' | 'snapshot'; issue?: LoadIssue; draftsApplied: number };

/**
 * This tab and the other tabs of the browser that share the saved workspace. `active`: this tab
 * reads what the others write and writes its own changes. `elsewhere`: another tab wrote over
 * work this tab was doing (the same draft edited in two tabs, or a write race), so this tab
 * stopped saving instead of overwriting it, until the person picks "Usar esta aba".
 */
export type TabState =
  | { status: 'active' }
  | { status: 'elsewhere'; reason: 'same-draft' | 'write-race'; since: string };

/** What reading another tab's write did: nothing new, the workspace reloaded, or a conflict. */
export type ExternalSync = 'unchanged' | 'reloaded' | 'conflict' | 'ignored';

/** A draft this tab saved this recently is being edited here: another tab changing it is a conflict. */
export const CONCURRENT_EDIT_MS = 20_000;

const defaultScheduler: Scheduler = (task, ms) => {
  const handle = setTimeout(task, ms);
  return () => clearTimeout(handle);
};

export type LocalStore = ReturnType<typeof createLocalStore>;

export function createLocalStore(options: LocalStoreOptions) {
  const { clock, ids, storage } = options;
  const schedule = options.scheduler ?? defaultScheduler;
  const deferredMs = options.deferredWriteMs ?? 400;
  const listeners = new Set<ChangeListener>();
  const saveListeners = new Set<(state: SaveState) => void>();

  let saveState: SaveState = { status: 'idle', scope: storage ? 'local' : 'memory' };
  let needsFullWrite = false;
  let dirtyDrafts = new Set<PieceId>();
  let cancelDeferred: (() => void) | undefined;

  // ——— Other tabs ———
  const tabId = options.tabId ?? ids.next('tab');
  let writeSeq = 0;
  let tab: TabState = { status: 'active' };
  const tabListeners = new Set<(state: TabState) => void>();
  /** When this tab last saved each draft (ms), to tell a concurrent edit from a quiet sync. */
  const draftSavedAt = new Map<PieceId, number>();

  function load(): { state: StoreState; report: LoadReport } {
    if (storage && options.reset) {
      try {
        clearSnapshot(storage);
      } catch {
        // Reset still proceeds from fixtures in memory.
      }
    }
    if (storage && !options.reset) {
      const loaded = readSnapshot(storage);
      if (loaded.kind === 'loaded') {
        return { state: loaded.state, report: { source: 'snapshot', draftsApplied: loaded.draftsApplied } };
      }
      if (loaded.kind === 'invalid') {
        return { state: normalizeSeed(options.seed()), report: { source: 'seed', issue: loaded.issue, draftsApplied: 0 } };
      }
    }
    return { state: normalizeSeed(options.seed()), report: { source: 'seed', draftsApplied: 0 } };
  }

  const initial = load();
  let state = initial.state;
  let loadReport = initial.report;
  /** The writer stamp of the saved workspace this tab's state is based on. */
  let lastWriter: string | null = storage ? readWriter(storage) : null;

  function setTab(next: TabState): void {
    tab = next;
    for (const listener of [...tabListeners]) listener(tab);
  }

  function enterElsewhere(reason: 'same-draft' | 'write-race'): void {
    cancelDeferred?.();
    cancelDeferred = undefined;
    needsFullWrite = true;
    if (tab.status !== 'elsewhere') setTab({ status: 'elsewhere', reason, since: clock.now() });
  }

  /** Before writing: false when another tab wrote since this tab last read (never overwrite it). */
  function mayWrite(): boolean {
    if (!storage) return true;
    if (tab.status === 'elsewhere') return false;
    if (readWriter(storage) === lastWriter) return true;
    enterElsewhere('write-race');
    return false;
  }

  function nextWriter(): string {
    writeSeq += 1;
    return `${tabId}:${writeSeq}`;
  }

  function setSaveState(next: SaveState): void {
    saveState = next;
    for (const listener of [...saveListeners]) listener(saveState);
  }

  function notify(notice: ChangeNotice): void {
    for (const listener of [...listeners]) listener(notice);
  }

  function writeFull(): boolean {
    if (!storage) return true;
    if (!mayWrite()) return false;
    const at = clock.now();
    const writer = nextWriter();
    try {
      writeSnapshot(storage, state, at, writer);
    } catch (error) {
      if (storageErrorCode(error) !== 'quota') return fail(error);
      try {
        state = compactState(state);
        writeSnapshot(storage, state, at, writer);
      } catch (retryError) {
        return fail(retryError);
      }
    }
    lastWriter = writer;
    needsFullWrite = false;
    dirtyDrafts = new Set();
    setSaveState({ status: 'saved', scope: 'local', savedAt: at });
    return true;
  }

  function fail(error: unknown): false {
    needsFullWrite = true;
    const code = storageErrorCode(error);
    setSaveState({ status: 'error', scope: 'local', error: { code, message: SAVE_ERROR_MESSAGES[code] } });
    return false;
  }

  function writeDrafts(): boolean {
    if (!storage) return true;
    if (needsFullWrite) return writeFull();
    if (!mayWrite()) return false;
    const drafts: Record<PieceId, WorkingDraft> = {};
    for (const pieceId of dirtyDrafts) {
      const location = locatePiece(state, pieceId);
      if (location) drafts[pieceId] = location.piece.draft;
    }
    const at = clock.now();
    const writer = nextWriter();
    try {
      writeDraftSlot(storage, drafts, at, writer);
    } catch (error) {
      return fail(error);
    }
    lastWriter = writer;
    setSaveState({ status: 'saved', scope: 'local', savedAt: at });
    return true;
  }

  function persist(mode: PersistMode): boolean {
    if (!storage || mode === 'none') return true;
    if (tab.status === 'elsewhere') {
      // Nothing is written while another tab owns the workspace; "Usar esta aba" reloads it.
      needsFullWrite = true;
      return false;
    }
    if (mode === 'deferred') {
      needsFullWrite = true;
      if (!cancelDeferred) {
        cancelDeferred = schedule(() => {
          cancelDeferred = undefined;
          if (needsFullWrite) writeFull();
        }, deferredMs);
      }
      return true;
    }
    cancelDeferred?.();
    cancelDeferred = undefined;
    if (mode === 'full') return writeFull();
    dirtyDrafts.add(mode.draft);
    draftSavedAt.set(mode.draft, Date.parse(clock.now()));
    return writeDrafts();
  }

  /** Productions whose record differs between two states (what a reload changed). */
  function changedProductions(before: StoreState, after: StoreState): ProductionId[] {
    const ids = new Set<ProductionId>();
    for (const entry of after.productions) {
      const previous = before.productions.find((candidate) => candidate.production.id === entry.production.id);
      if (!previous || JSON.stringify(previous) !== JSON.stringify(entry)) ids.add(entry.production.id);
    }
    for (const entry of before.productions) if (!after.productions.some((candidate) => candidate.production.id === entry.production.id)) ids.add(entry.production.id);
    return [...ids];
  }

  /** A draft this tab saved moments ago that the other tab changed too: two people (or windows) on one text. */
  function editsSameDraft(next: StoreState): boolean {
    const now = Date.parse(clock.now());
    for (const [pieceId, at] of draftSavedAt) {
      if (now - at > CONCURRENT_EDIT_MS) continue;
      const mine = locatePiece(state, pieceId)?.piece.draft;
      const theirs = locatePiece(next, pieceId)?.piece.draft;
      if (mine && theirs && (theirs.revision !== mine.revision || theirs.updatedAt !== mine.updatedAt)) return true;
    }
    return false;
  }

  /** Replaces the state with what is saved now (another tab's write, or "Usar esta aba"). */
  function adoptSaved(): boolean {
    if (!storage) return false;
    const writer = readWriter(storage);
    const loaded = readSnapshot(storage);
    if (loaded.kind === 'invalid') return false;
    const next = loaded.kind === 'loaded' ? loaded.state : normalizeSeed(options.seed());
    cancelDeferred?.();
    cancelDeferred = undefined;
    needsFullWrite = false;
    dirtyDrafts = new Set();
    draftSavedAt.clear();
    const before = state;
    state = next;
    lastWriter = writer;
    notify({ scope: 'external', productionIds: changedProductions(before, next), activity: [] });
    return true;
  }

  function context(actorId?: ActorId): CommandContext {
    return { now: clock.now(), newId: (prefix) => ids.next(prefix), actorId: actorId ?? state.sessionPersonId };
  }

  function stamp(drafts: readonly ActivityDraft[], ctx: CommandContext): ActivityEvent[] {
    return drafts.map((draft) => {
      const { actorId, ...rest } = draft;
      return { ...rest, id: ctx.newId('act'), workspaceId: state.workspace.id, actorId: actorId ?? ctx.actorId, at: ctx.now };
    });
  }

  /**
   * Runs a change. The function receives the current state and must return a NEW state (domain
   * functions are pure); a refusal leaves everything untouched.
   */
  function transact<T, C extends string>(
    fn: (current: StoreState, ctx: CommandContext) => Result<Change<T>, C>,
    options: { actorId?: ActorId } = {},
  ): Result<T, C> {
    const ctx = context(options.actorId);
    const outcome = fn(state, ctx);
    if (!outcome.ok) return outcome;
    const change = outcome.value;
    const events = stamp(change.activity ?? [], ctx);
    state = events.length > 0 ? { ...change.state, activity: [...change.state.activity, ...events] } : change.state;
    persist(change.persist ?? 'full');
    if (!change.silent) {
      notify({
        scope: change.scope ?? 'productions',
        productionIds: change.productionIds ?? [],
        activity: events.map((event) => event.type),
      });
    }
    return { ok: true, value: change.value };
  }

  return {
    get state(): StoreState {
      return state;
    },
    get loadReport(): LoadReport {
      return loadReport;
    },
    clock,
    ids,
    context,
    transact,
    subscribe(listener: ChangeListener): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    saveState: () => saveState,
    subscribeSaveState(listener: (next: SaveState) => void): Unsubscribe {
      saveListeners.add(listener);
      return () => {
        saveListeners.delete(listener);
      };
    },
    /** Writes the full snapshot again (ActionBar "Tentar de novo"). */
    retrySave(): boolean {
      cancelDeferred?.();
      cancelDeferred = undefined;
      return writeFull();
    },
    /** Forces pending coalesced writes now (route change, `pagehide`). */
    flush(): boolean {
      if (!cancelDeferred && !needsFullWrite && dirtyDrafts.size === 0) return true;
      cancelDeferred?.();
      cancelDeferred = undefined;
      return writeFull();
    },
    /** Which tab owns the saved workspace (see `TabState`). */
    tabState: (): TabState => tab,
    subscribeTab(listener: (next: TabState) => void): Unsubscribe {
      tabListeners.add(listener);
      return () => {
        tabListeners.delete(listener);
      };
    },
    /**
     * Another tab of this browser wrote the saved workspace (a `storage` event). An idle tab
     * reloads it at once (screens refresh with an `external` notice); a tab editing the same
     * draft stops saving and reports `conflict` instead of overwriting the other tab.
     */
    syncExternal(): ExternalSync {
      if (!storage || tab.status === 'elsewhere') return 'ignored';
      if (readWriter(storage) === lastWriter) return 'unchanged';
      const loaded = readSnapshot(storage);
      if (loaded.kind === 'invalid') return 'unchanged';
      if (saveState.status === 'error' || (loaded.kind === 'loaded' && editsSameDraft(loaded.state))) {
        enterElsewhere('same-draft');
        return 'conflict';
      }
      return adoptSaved() ? 'reloaded' : 'unchanged';
    },
    /** "Usar esta aba": reload what the other tab saved and become the tab that writes again. */
    takeOver(): boolean {
      if (!storage) return false;
      const adopted = adoptSaved();
      if (!adopted) lastWriter = readWriter(storage);
      setTab({ status: 'active' });
      if (!adopted) writeFull();
      return true;
    },
    /** Restores the fixtures (`?reset=1`, "Recomeçar demonstração"). */
    reset(): void {
      cancelDeferred?.();
      cancelDeferred = undefined;
      if (storage) {
        try {
          clearSnapshot(storage);
        } catch {
          // Memory state is reset regardless.
        }
      }
      state = normalizeSeed(options.seed());
      loadReport = { source: 'seed', draftsApplied: 0 };
      needsFullWrite = false;
      dirtyDrafts = new Set();
      draftSavedAt.clear();
      lastWriter = storage ? readWriter(storage) : null;
      if (tab.status !== 'active') setTab({ status: 'active' });
      setSaveState({ status: 'idle', scope: storage ? 'local' : 'memory' });
      notify({ scope: 'reset', productionIds: [], activity: [] });
    },
    dispose(): void {
      cancelDeferred?.();
      cancelDeferred = undefined;
      listeners.clear();
      saveListeners.clear();
      tabListeners.clear();
    },
  };
}
