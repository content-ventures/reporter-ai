import { createIndexedDbAssetStore, createMemoryAssetStore } from '../adapters/local/assets/index.ts';
import { createLocalAudit } from '../adapters/local/audit/index.ts';
import { createLocalExportService } from '../adapters/local/export/index.ts';
import { applyRunUpdate, createLocalGenerationService, keepLiveRun, recoverOrphanRuns } from '../adapters/local/generation/index.ts';
import type { Sleep } from '../adapters/local/generation/index.ts';
import { assetCoverLoader, createLocalRenderService, servedCoverLoader } from '../adapters/local/render/index.ts';
import { browserLocalStorage, createIdGenerator, createLocalPorts, systemClock, WORKSPACE_KEYS } from '../adapters/local/store/index.ts';
import type { LocalPorts } from '../adapters/local/store/index.ts';
import { creditLine } from '../domain/asset.ts';
import type { ProductionId, RunId } from '../domain/ids.ts';
import { usedAssetIds } from '../domain/record.ts';
import type { ProductionRecord } from '../domain/record.ts';
import type { CommandContext } from '../domain/result.ts';
import type { RunFold } from '../domain/run-events.ts';
import { isRunActive } from '../domain/run.ts';
import { R1_FLOW } from '../domain/stage.ts';
import { auditAnchor, seededAuditEvents } from '../fixtures/audit.ts';
import { createFixtures, fixtureSeed } from '../fixtures/index.ts';
import type { AssetChange, AssetStore } from '../ports/assets.ts';
import type { ChangeListener } from '../ports/common.ts';
import type { SaveState, SaveStatusPort } from '../ports/save-status.ts';
import type { Clock, IdGenerator } from '../ports/system.ts';
import { DEFAULT_FLOW_ID, flowById, gatesFor } from '../registries/index.ts';
import { DEFAULT_LATENCY, withFirstLoadLatency, withFirstReadLatency } from './latency.ts';
import type { LatencyOptions } from './latency.ts';
import { createRunLeases } from './run-leases.ts';
import type { RunLeases } from './run-leases.ts';
import { createRunSync } from './run-sync.ts';
import type { Runtime, RuntimeStorage, SimulationInfo, TabSync } from './runtime.ts';

/**
 * Composition root of the simulated runtime: the ONLY module that imports adapters and fixtures.
 * It wires the local store, the simulated generation (runs live here, so leaving a page never
 * cancels them; they settle through the store and log their activity), render and export, and
 * opens the demo workspace: fresh fixtures (the flagship run continues in place) or the snapshot
 * saved in this browser (runs a reload killed end "interrompida", keeping their partial).
 */

export type CreateRuntimeOptions = {
  clock?: Clock;
  ids?: IdGenerator;
  /** Default: the browser's localStorage when available. `null` keeps the workspace in memory. */
  storage?: RuntimeStorage | null;
  /** `?reset=1`: drop the saved workspace and reopen the fixtures. */
  reset?: boolean;
  /** "Começar vazio": team and templates only, no productions. */
  empty?: boolean;
  /** First-load latency of reads (default 150–300 ms); `false` answers at once. */
  latency?: LatencyOptions | false;
  /** Simulated generation pacing; tests inject an instant sleep. */
  sleep?: Sleep;
  /** Multiplies every simulated delay (1 = natural pace). */
  pace?: number;
  /** Seed of the deterministic simulation. */
  seed?: string;
  /** Continue seeded runs that are mid-stream when the fixtures open (default true). */
  adoptLiveRuns?: boolean;
  /** Delay before a streamed text delta reaches the store (default 500 ms). */
  deltaFlushMs?: number;
  /** Delay of coalesced snapshot writes (default 400 ms). */
  deferredWriteMs?: number;
  /**
   * Where article images live. Default: IndexedDB when the workspace persists in this browser,
   * memory otherwise (`storage: null`, Node). Tests may pass their own store.
   */
  assets?: AssetStore | 'indexeddb' | 'memory';
  /**
   * Writes of OTHER tabs to the saved workspace (A10). Default: the window's `storage` event
   * when the workspace lives in the browser's localStorage; tests pass their own source.
   */
  otherTabs?: OtherTabs | null;
  /**
   * Template typeface → CSS family the page loaded for it (the DS registers Inter under its own
   * name). The client passes it so slide PNGs and line fit use the real face, not a fallback.
   */
  typefaces?: Readonly<Record<string, string>>;
  /**
   * A04 · a reload or a new tab never interrupts a generation: a run nobody drives continues in
   * the tab that finds it, unless another tab still holds it (`run-leases.ts`). Default: on with
   * the browser's localStorage (this tab's id kept in sessionStorage); `false` closes such runs
   * as "interrompida" at load, as before. Tests pass their own tab, clock and timers.
   */
  continueRuns?: ContinueRunsOptions | false;
};

export type ContinueRunsOptions = {
  /** This tab, stable across its reloads. */
  tab: string;
  /** Wall clock in ms. */
  now: () => number;
  /** Repeats `tick` every `ms`; returns the stop. */
  every: (tick: () => void, ms: number) => () => void;
  /** Runs `task` after `ms` (a claim is confirmed a moment after it is written). */
  later: (task: () => void, ms: number) => void;
  staleMs?: number;
  graceMs?: number;
};

/** How often a tab renews its leases and looks for runs nobody drives. */
const LEASE_BEAT_MS = 1_000;
/** A claim is confirmed this long after it is written (another tab may have claimed too). */
const CLAIM_CONFIRM_MS = 150;

const TAB_KEY = 'reporter:tab:v1';

/** This tab's id across reloads (sessionStorage), or a new one. */
function browserTab(): string {
  const fresh = `tab-${Math.random().toString(36).slice(2, 10)}`;
  try {
    const session = (globalThis as { sessionStorage?: RuntimeStorage }).sessionStorage;
    if (!session) return fresh;
    const known = session.getItem(TAB_KEY);
    if (known) return known;
    session.setItem(TAB_KEY, fresh);
    return fresh;
  } catch {
    return fresh;
  }
}

function browserContinueRuns(): ContinueRunsOptions {
  return {
    tab: browserTab(),
    now: () => Date.now(),
    every: (tick, ms) => {
      const handle = setInterval(tick, ms);
      return () => clearInterval(handle);
    },
    later: (task, ms) => void setTimeout(task, ms),
  };
}

/** Calls `onWrite` whenever another tab writes the saved workspace. */
export type OtherTabs = { subscribe(onWrite: () => void): () => void };

/** The browser's `storage` event: it fires only in the OTHER tabs of the same origin. */
function storageEvents(): OtherTabs | null {
  const target = globalThis as { addEventListener?: (type: string, listener: (event: { key: string | null }) => void) => void; removeEventListener?: (type: string, listener: (event: { key: string | null }) => void) => void };
  if (typeof target.addEventListener !== 'function' || typeof target.removeEventListener !== 'function') return null;
  return {
    subscribe(onWrite) {
      const listener = (event: { key: string | null }) => {
        if (event.key === null || WORKSPACE_KEYS.includes(event.key)) onWrite();
      };
      target.addEventListener?.('storage', listener);
      return () => target.removeEventListener?.('storage', listener);
    },
  };
}

type Recover = (record: ProductionRecord, folds: Readonly<Record<RunId, RunFold>>, ctx: CommandContext) => ProductionRecord;

/** `recoverOrphanRuns` restricted to some runs; every other run keeps its object and position. */
function recoverOnly(targets: ReadonlySet<RunId>): Recover {
  return (record, folds, ctx) => {
    const subset = { ...record, runs: record.runs.filter((run) => !isRunActive(run) || targets.has(run.id)) };
    const recovered = recoverOrphanRuns(subset, folds, ctx);
    const byId = new Map(recovered.runs.map((run) => [run.id, run]));
    return { ...recovered, runs: record.runs.map((run) => byId.get(run.id) ?? run) };
  };
}

/** Closes active runs nobody drives (except `keep`) as "interrompida"; returns their ids. */
function recoverOrphans(ports: LocalPorts, keep: ReadonlySet<RunId>): RunId[] {
  const recovered: RunId[] = [];
  for (const productionId of ports.records.productionsWithActiveRuns()) {
    const record = ports.records.record(productionId);
    const targets = new Set((record?.runs ?? []).filter((run) => isRunActive(run) && !keep.has(run.id)).map((run) => run.id));
    if (targets.size === 0) continue;
    const result = ports.records.apply(productionId, (current, ctx) => recoverOnly(targets)(current, ports.records.runFolds(), ctx), { persist: 'full' });
    if (result.ok) recovered.push(...targets);
  }
  return recovered;
}

function liveParentFolds(ports: LocalPorts): RunFold[] {
  return Object.values(ports.records.runFolds()).filter((fold) => isRunActive(fold.run) && !fold.run.parentRunId);
}

/**
 * One save status for the studio: the workspace snapshot (localStorage) and the image store
 * (IndexedDB). An image that could not be stored is an error like any other save error, with
 * "Tentar de novo" retrying both. The snapshot object is stable while nothing changes.
 */
function combinedSaveStatus(base: SaveStatusPort, assets: AssetStore): SaveStatusPort {
  let last: { base: SaveState; health: ReturnType<AssetStore['health']>; merged: SaveState } | undefined;
  const current = (): SaveState => {
    const state = base.current();
    const health = assets.health();
    if (last && last.base === state && last.health === health) return last.merged;
    const merged: SaveState =
      state.status !== 'error' && health.status === 'error'
        ? { status: 'error', scope: state.scope, ...(state.savedAt ? { savedAt: state.savedAt } : {}), error: { code: health.code, message: health.message } }
        : state;
    last = { base: state, health, merged };
    return merged;
  };
  return {
    current,
    async retry() {
      await assets.retry();
      const result = await base.retry();
      const state = current();
      if (state.status === 'error') return { ok: false, refusal: { code: 'save_failed', message: state.error?.message ?? 'Não foi possível salvar.' } };
      return result.ok ? { ok: true, value: state } : result;
    },
    subscribe(listener) {
      const notify = () => listener(current());
      const offBase = base.subscribe(notify);
      const offAssets = assets.subscribe((change) => {
        if (change.kind === 'health') notify();
      });
      return () => {
        offBase();
        offAssets();
      };
    },
  };
}

export function createRuntime(options: CreateRuntimeOptions = {}): Runtime {
  const clock = options.clock ?? systemClock();
  const ids = options.ids ?? createIdGenerator();
  const storage = options.storage === null ? undefined : (options.storage ?? browserLocalStorage());
  const fixtures = createFixtures({ now: clock.now(), ...(options.empty ? { empty: true } : {}) });
  const templates = fixtures.templates;
  let disposed = false;

  // The image store is created once the workspace is open (it needs to know whether a snapshot
  // was found); reads before that see no images.
  const images: { current?: AssetStore } = {};
  let assetsRevision = 0;

  const ports = createLocalPorts({
    seed: () => fixtureSeed(fixtures),
    clock,
    ids,
    storage,
    reset: options.reset === true,
    deferredWriteMs: options.deferredWriteMs,
    templates,
    flow: flowById(DEFAULT_FLOW_ID) ?? R1_FLOW,
    gates: gatesFor(),
    recoverOrphanedRuns: false,
    assets: (assetId) => images.current?.get(assetId),
    assetsRevision: () => assetsRevision,
  });

  // Images belong to the saved workspace: `?reset=1`, "Restaurar exemplo", "Começar vazio" and a
  // workspace reopened from the fixtures (no snapshot in this browser) start without images.
  const freshWorkspace = options.reset === true || ports.store.loadReport.source === 'seed';
  const assetOptions = {
    clock,
    ids,
    workspaceId: fixtures.workspace.id,
    actorId: () => ports.store.state.sessionPersonId,
    reset: freshWorkspace,
    // The example's own images (served from public/samples/), listed like uploads.
    seed: fixtures.images,
  };
  const ownsImages = typeof options.assets !== 'object';
  const imageStore: AssetStore =
    typeof options.assets === 'object'
      ? options.assets
      : (options.assets ?? (storage ? 'indexeddb' : 'memory')) === 'indexeddb'
        ? createIndexedDbAssetStore(assetOptions)
        : createMemoryAssetStore(assetOptions);
  if (!ownsImages && options.reset === true) void imageStore.reset();
  images.current = imageStore;

  // Image changes refresh what shows them (checks, review, package) like any other change.
  const assetListeners = new Set<ChangeListener>();
  const unwatchAssets = imageStore.subscribe((change: AssetChange) => {
    if (change.kind === 'health') return;
    assetsRevision += 1;
    for (const listener of [...assetListeners]) listener({ scope: 'assets', productionIds: change.productionIds, activity: [] });
  });

  const render = createLocalRenderService({
    templates,
    renders: fixtures.templateRenders,
    descriptions: fixtures.templateDescriptions,
    library: fixtures.templateLibrary,
    loadCover: assetCoverLoader(imageStore),
    coverCredit: (assetId) => creditLine(imageStore.get(assetId)?.credit),
    samplePhoto: { assetId: fixtures.samplePhoto.assetId, credit: fixtures.samplePhoto.credit, load: servedCoverLoader(fixtures.samplePhoto.src) },
    ...(options.typefaces ? { typefaces: options.typefaces } : {}),
  });

  const getRecord = (productionId: ProductionId) => ports.records.record(productionId);

  const generation = createLocalGenerationService({
    clock,
    ids,
    getRecord,
    actorId: async () => (await ports.session.current())?.id ?? fixtures.viewerId,
    scripts: fixtures.scriptBook,
    templates: () => render.templates(),
    people: () => ports.store.state.people,
    measure: (body) => {
      const measured = render.measure(body);
      return measured.ok ? measured.value : [];
    },
    sleep: options.sleep,
    pace: options.pace,
    seed: options.seed,
    persistedFold: (runId) => ports.runs.fold(runId),
  });

  const exporter = createLocalExportService({ clock, getRecord, render, assets: imageStore });

  const sync = createRunSync(
    (update) => {
      ports.records.apply(update.meta.productionId, (record, ctx) => applyRunUpdate(record, update, ctx), { runFold: update.fold });
    },
    { flushMs: options.deltaFlushMs },
  );
  const unwatch = generation.watch((update) => sync.push(update));

  const simulation: SimulationInfo = {
    loadedFrom: ports.store.loadReport.source === 'snapshot' ? 'snapshot' : 'fixtures',
    adoptedRunIds: [],
    recoveredRunIds: [],
  };

  // Fresh fixtures: seeded runs that are mid-stream continue in place. Registration happens
  // synchronously inside `adopt`, so the recovery below already sees them as driven.
  const adoptions =
    simulation.loadedFrom === 'fixtures' && options.adoptLiveRuns !== false
      ? liveParentFolds(ports).map((fold) => {
          simulation.adoptedRunIds.push(fold.run.id);
          return generation.adopt(fold).then(
            (result) => ({ runId: fold.run.id, adopted: result.ok }),
            () => ({ runId: fold.run.id, adopted: false }),
          );
        })
      : [];
  // A04: with leases, runs a reload or another tab left behind continue (see `continueOrphans`);
  // without them they close as "interrompida" right away.
  const continueOptions =
    options.continueRuns === false ? undefined : (options.continueRuns ?? (options.storage === undefined && storage ? browserContinueRuns() : undefined));
  const leases: RunLeases | undefined =
    continueOptions && storage
      ? createRunLeases({
          storage,
          tab: continueOptions.tab,
          now: continueOptions.now,
          ...(continueOptions.staleMs !== undefined ? { staleMs: continueOptions.staleMs } : {}),
          ...(continueOptions.graceMs !== undefined ? { graceMs: continueOptions.graceMs } : {}),
        })
      : undefined;
  // Fresh fixtures: seeded runs not adopted (and the section runs of the adopted ones) close now.
  if (!leases || simulation.loadedFrom === 'fixtures') simulation.recoveredRunIds.push(...recoverOrphans(ports, new Set(simulation.adoptedRunIds)));

  const runsSettled = Promise.all(adoptions).then((results) => {
    const refused = new Set(results.filter((entry) => !entry.adopted).map((entry) => entry.runId));
    if (refused.size === 0 || disposed) return;
    simulation.adoptedRunIds = simulation.adoptedRunIds.filter((runId) => !refused.has(runId));
    const keep = new Set(simulation.adoptedRunIds);
    simulation.recoveredRunIds.push(...recoverOrphans(ports, keep));
  });
  // ——— Runs nobody drives (A04) ———
  const claiming = new Set<RunId>();
  const continueOrphans = () => {
    if (disposed || !leases || !continueOptions) return;
    const live = generation.snapshots({ activeOnly: true });
    const driven = new Set(live.map((snapshot) => snapshot.meta.runId));
    leases.beat(live.filter((snapshot) => !snapshot.meta.child).map((snapshot) => snapshot.meta.runId));
    const folds = ports.records.runFolds();
    for (const productionId of ports.records.productionsWithActiveRuns()) {
      const record = ports.records.record(productionId);
      for (const run of record?.runs ?? []) {
        if (!isRunActive(run) || run.parentRunId || driven.has(run.id) || claiming.has(run.id) || !leases.free(run.id)) continue;
        const confirm = leases.claim(run.id);
        claiming.add(run.id);
        continueOptions.later(() => {
          claiming.delete(run.id);
          if (disposed) return;
          if (!confirm()) return;
          void continueRun(productionId, run.id, folds[run.id]);
        }, CLAIM_CONFIRM_MS);
      }
    }
  };
  /** Continues a claimed run in place; a run that cannot continue closes as "interrompida". */
  const continueRun = async (productionId: ProductionId, runId: RunId, seen: RunFold | undefined) => {
    const fold = ports.records.runFolds()[runId] ?? seen;
    const adopted = fold && isRunActive(fold.run) ? await generation.adopt(fold, { strict: true }) : undefined;
    if (disposed) return;
    const driven = new Set(generation.snapshots({ activeOnly: true }).map((snapshot) => snapshot.meta.runId));
    const record = ports.records.record(productionId);
    // Section runs of the earlier life are replaced by the ones the continued run opens.
    const stale = (record?.runs ?? []).filter((entry) => isRunActive(entry) && !driven.has(entry.id) && (entry.parentRunId === runId || (entry.id === runId && !adopted?.ok)));
    if (stale.length > 0) {
      const targets = new Set(stale.map((entry) => entry.id));
      ports.records.apply(productionId, (current, ctx) => recoverOnly(targets)(current, ports.records.runFolds(), ctx), { persist: 'full' });
    }
    if (adopted?.ok) simulation.adoptedRunIds.push(runId);
    else {
      simulation.recoveredRunIds.push(runId);
      leases?.release(runId);
    }
  };
  let stopLeases: (() => void) | undefined;
  let onPageHide: (() => void) | undefined;
  if (leases && continueOptions) {
    // Fixture runs adopted above are this tab's from the start; the rest is looked at now and on every beat.
    void runsSettled.then(() => continueOrphans());
    stopLeases = continueOptions.every(continueOrphans, LEASE_BEAT_MS);
    const target = globalThis as { addEventListener?: (type: string, listener: () => void) => void; removeEventListener?: (type: string, listener: () => void) => void };
    if (options.continueRuns === undefined && typeof target.addEventListener === 'function') {
      onPageHide = () => leases.leave();
      target.addEventListener('pagehide', onPageHide);
    }
  }

  const ready = Promise.all([runsSettled, imageStore.ready()]).then(() => undefined);

  // Logs (F1.7): the activity feed as an audit trail, plus the seeded history anchored to the
  // workspace's fixture clock (stable across reloads) and what this browser records live.
  const localAudit = createLocalAudit({
    store: ports.store,
    clock,
    storage,
    reset: freshWorkspace,
    seed: () => {
      if (options.empty) return [];
      const state = ports.store.state;
      return seededAuditEvents({ now: auditAnchor(state.workspace), productions: state.productions, sources: state.sources });
    },
  });

  // REQ-T.1 (B06): opening a production restricted to another team enters the trail as a denial.
  const guardedQueries: typeof ports.queries = {
    ...ports.queries,
    async get(productionId) {
      const result = await ports.queries.get(productionId);
      if (!result.ok && result.refusal.code === 'restricted') {
        const label = ports.store.state.productions.find((entry) => entry.production.id === productionId)?.production.title ?? productionId;
        localAudit.recordDenial({ kind: 'production', id: productionId, label, productionId }, result.refusal.message);
      }
      return result;
    },
  };
  const queries = options.latency === false ? guardedQueries : withFirstLoadLatency(guardedQueries, options.latency ?? DEFAULT_LATENCY);
  const audit = options.latency === false ? localAudit : withFirstReadLatency(localAudit, ['list', 'get'], options.latency ?? DEFAULT_LATENCY);

  const flush = () => {
    if (disposed) return;
    sync.flush();
    ports.store.flush();
  };

  // ——— Other tabs (A10) ———
  // A run this tab drives survives a reload of the saved workspace: its live state is written back.
  const keepLiveRuns = () => {
    for (const { meta, fold } of generation.snapshots({ activeOnly: true })) {
      ports.records.apply(meta.productionId, (record) => keepLiveRun(record, fold.run), { runFold: fold });
    }
  };
  const otherTabs = options.otherTabs === undefined ? (options.storage === undefined && storage ? storageEvents() : null) : options.otherTabs;
  let cancelTabSync: (() => void) | undefined;
  const unwatchTabs = otherTabs?.subscribe(() => {
    // One write is several keys (snapshot, draft slot, writer): read them once, together.
    if (disposed || cancelTabSync) return;
    const handle = setTimeout(() => {
      cancelTabSync = undefined;
      if (disposed) return;
      sync.flush();
      if (ports.store.syncExternal() === 'reloaded') keepLiveRuns();
    }, 30);
    cancelTabSync = () => clearTimeout(handle);
  });
  const tabs: TabSync = {
    current: () => ports.store.tabState(),
    subscribe: (listener) => ports.store.subscribeTab(listener),
    claim: () => {
      if (disposed) return;
      sync.flush();
      ports.store.takeOver();
      keepLiveRuns();
    },
  };

  return {
    mode: 'simulated',
    queries,
    commands: ports.commands,
    ingest: ports.ingest,
    generation,
    render,
    export: exporter,
    session: ports.session,
    feedback: ports.feedback,
    saveStatus: combinedSaveStatus(ports.saveStatus, imageStore),
    assets: imageStore,
    audit,
    tabs,
    usedAssetIds: () => usedAssetIds(ports.store.state.productions),
    clock,
    ids,
    simulation,
    ready,
    subscribe: (listener) => {
      const offStore = ports.queries.subscribe(listener);
      const offAudit = localAudit.subscribe(listener);
      const forward: ChangeListener = (notice) => listener(notice);
      assetListeners.add(forward);
      return () => {
        offStore();
        offAudit();
        assetListeners.delete(forward);
      };
    },
    flush,
    dispose() {
      if (disposed) return;
      flush();
      disposed = true;
      unwatch();
      unwatchTabs?.();
      cancelTabSync?.();
      sync.dispose();
      // Stop the timers of runs still streaming; the saved workspace keeps them active, so the
      // next load continues them (A04) or, without leases, closes them as "interrompida".
      stopLeases?.();
      leases?.leave();
      if (onPageHide) (globalThis as { removeEventListener?: (type: string, listener: () => void) => void }).removeEventListener?.('pagehide', onPageHide);
      for (const snapshot of generation.snapshots({ activeOnly: true })) {
        if (!snapshot.meta.child) void generation.cancel(snapshot.meta.runId);
      }
      localAudit.dispose();
      ports.store.dispose();
      unwatchAssets();
      assetListeners.clear();
      if (ownsImages) imageStore.dispose();
    },
  };
}
