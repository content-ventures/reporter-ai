import { R1_GATES } from '../../../domain/decision.ts';
import { R1_FLOW } from '../../../domain/stage.ts';
import type { FeedbackPort } from '../../../ports/feedback.ts';
import type { ProductionCommands } from '../../../ports/production-commands.ts';
import type { ProductionQueries } from '../../../ports/production-queries.ts';
import type { SaveStatusPort } from '../../../ports/save-status.ts';
import type { SessionPort } from '../../../ports/session.ts';
import type { SourceIngest } from '../../../ports/source-ingest.ts';
import { createFeedbackPort, createOutputCommands } from './commands-output.ts';
import { createPieceCommands } from './commands-piece.ts';
import { createProductionCommands } from './commands-production.ts';
import { createLocalIngest } from './ingest.ts';
import { createLocalStore } from './local-store.ts';
import type { LocalStore, LocalStoreOptions } from './local-store.ts';
import { createLocalQueries, createReadContext, detach } from './queries.ts';
import type { ReadOptions } from './queries.ts';
import { createRecordAccess } from './record-access.ts';
import type { RecordAccess } from './record-access.ts';
import { createRunLedger } from './runs.ts';
import type { RunLedger } from './runs.ts';
import { createLocalSession } from './session.ts';

/**
 * Local simulated adapter for the production ports. `src/runtime/create-runtime.ts` is the only
 * module that should call this; screens see the ports, never the store.
 */

export type LocalPortsOptions = LocalStoreOptions &
  ReadOptions & {
    /** Settle runs left streaming by a previous page load as "interrompida" (default true). */
    recoverOrphanedRuns?: boolean;
  };

export type LocalPorts = {
  store: LocalStore;
  /** Write path of generation adapters (`LocalGenerationDeps.ledger`); not a screen-facing port. */
  runs: RunLedger;
  /** Record-level read/write path (`LocalGenerationDeps.getRecord`, recovery, future adapters). */
  records: RecordAccess;
  queries: ProductionQueries;
  commands: ProductionCommands;
  ingest: SourceIngest;
  session: SessionPort;
  feedback: FeedbackPort;
  saveStatus: SaveStatusPort;
  /** Runs settled as "interrompida" at startup (a reload killed their in-memory stream). */
  recoveredRuns: string[];
};

/** Every command result crosses the boundary as a copy, like a network response. */
function detachAll<T extends object>(impl: T): T {
  const wrapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(impl)) {
    wrapped[key] =
      typeof value === 'function'
        ? async (...args: unknown[]) => detach(await (value as (...input: unknown[]) => Promise<unknown>)(...args))
        : value;
  }
  return wrapped as T;
}

export function createLocalPorts(options: LocalPortsOptions): LocalPorts {
  const store = createLocalStore(options);
  const read = createReadContext(store, options);
  const templates = options.templates ?? [];
  const gates = options.gates ?? R1_GATES;
  const feedback = createFeedbackPort(store);
  const commands: ProductionCommands = detachAll({
    ...createProductionCommands(store, read, options.flow ?? R1_FLOW),
    ...createPieceCommands(store, { templates, gates, ...(options.assets ? { assets: options.assets } : {}) }),
    ...createOutputCommands(store, feedback),
  });
  const runs = createRunLedger(store);
  const recoveredRuns = options.recoverOrphanedRuns !== false && store.loadReport.source === 'snapshot' ? runs.recoverOrphanedRuns() : [];
  return {
    store,
    runs,
    records: createRecordAccess(store),
    queries: createLocalQueries(store, options),
    commands,
    ingest: createLocalIngest(store),
    session: createLocalSession(store),
    feedback,
    saveStatus: {
      current: () => store.saveState(),
      async retry() {
        return store.retrySave()
          ? { ok: true, value: store.saveState() }
          : { ok: false, refusal: { code: 'save_failed', message: store.saveState().error?.message ?? 'Não foi possível salvar.' } };
      },
      subscribe: (listener) => store.subscribeSaveState(listener),
    },
    recoveredRuns,
  };
}

export { createLocalStore } from './local-store.ts';
export type { ActivityDraft, Change, ExternalSync, LocalStore, LocalStoreOptions, LoadReport, PersistMode, TabState, Tx } from './local-store.ts';
export { CONCURRENT_EDIT_MS } from './local-store.ts';
export type { BeginRunInput, BeginRunRefusal, RunLedger, SettleOutcome, SettledRun, SuggestionInput } from './runs.ts';
export { VERSIONING_RUN_KINDS } from './runs.ts';
export { activityBetween } from './record-access.ts';
export type { ApplyOptions, RecordAccess, RecordTransform } from './record-access.ts';
export type { StoreSeed, StoreState, ProductionState } from './state.ts';
export { normalizeSeed, assembleRecord } from './state.ts';
export { memoryStorage, browserLocalStorage, StorageQuotaError } from './storage.ts';
export type { KeyValueStorage } from './storage.ts';
export { SNAPSHOT_KEY, DRAFT_SLOT_KEY, WRITER_KEY, WORKSPACE_KEYS } from './snapshot.ts';
export { systemClock, manualClock, createIdGenerator, sequentialIds } from './system.ts';
export type { ManualClock } from './system.ts';
export { INGEST_LIMITS } from './ingest.ts';
export type { ReadOptions } from './queries.ts';
