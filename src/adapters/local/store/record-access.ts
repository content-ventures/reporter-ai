import type { ActorId, ProductionId, RunId } from '../../../domain/ids.ts';
import { toVersionRef } from '../../../domain/piece.ts';
import type { ProductionRecord } from '../../../domain/record.ts';
import { ok, refuse } from '../../../domain/result.ts';
import type { CommandContext, Result } from '../../../domain/result.ts';
import type { RunFold } from '../../../domain/run-events.ts';
import { isRunActive } from '../../../domain/run.ts';
import { stableStringify } from '../../../domain/text/hash.ts';
import type { ActivityDraft, LocalStore, PersistMode, Tx } from './local-store.ts';
import { assembleRecord, findProduction, withProduction } from './state.ts';
import type { ProductionState, StoreState } from './state.ts';

/**
 * Record-level write path for adapters that are not commands, chiefly generation: the runtime
 * wires `GenerationService.watch` to `apply(productionId, record => applyRunUpdate(record, …))`.
 * The store stays the single writer: it persists, notifies, keeps the stream snapshot for
 * `attach` after a reload, and derives the semantic activity from what actually changed.
 */

export type RecordTransform = (record: ProductionRecord, ctx: CommandContext) => ProductionRecord;

export type ApplyOptions = {
  /** Latest stream snapshot of a run (persisted for re-attach and reload recovery). */
  runFold?: RunFold;
  /** Override persistence; default: `full` when something semantic happened, else `deferred`. */
  persist?: PersistMode;
  actorId?: ActorId;
};

const RECORD_KEYS = ['production', 'pieces', 'versions', 'decisions', 'reviewRequests', 'runs', 'suggestions', 'deliveries', 'sources'] as const;

function sameContent(a: ProductionRecord, b: ProductionRecord): boolean {
  return RECORD_KEYS.every((key) => a[key] === b[key] || stableStringify(a[key]) === stableStringify(b[key]));
}

/** Semantic activity implied by a record change (runs started/ended, versions born). */
export function activityBetween(before: ProductionRecord, after: ProductionRecord): ActivityDraft[] {
  const productionId = after.production.id;
  const activity: ActivityDraft[] = [];
  for (const run of after.runs) {
    if (run.parentRunId) continue;
    const previous = before.runs.find((entry) => entry.id === run.id);
    if (!previous) activity.push({ type: 'run.started', productionId, actorId: run.createdBy, data: { runKind: run.kind } });
    if ((!previous || isRunActive(previous)) && !isRunActive(run)) {
      activity.push({ type: `run.${run.status as 'completed' | 'failed' | 'cancelled'}`, productionId, actorId: run.createdBy, data: { runKind: run.kind } });
    }
  }
  for (const version of after.versions) {
    if (before.versions.some((entry) => entry.id === version.id)) continue;
    const piece = after.pieces.find((entry) => entry.id === version.pieceId);
    activity.push({
      type: 'version.created',
      productionId,
      actorId: version.createdBy,
      subject: toVersionRef(version),
      data: { ...(piece ? { piece: piece.kind } : {}), number: version.number, origin: version.origin, ...(version.interrupted ? { interrupted: true } : {}) },
    });
  }
  return activity;
}

function writeBack(state: StoreState, record: ProductionRecord): StoreState {
  const next: ProductionState = {
    production: record.production,
    pieces: record.pieces,
    versions: record.versions,
    decisions: record.decisions,
    reviewRequests: record.reviewRequests,
    runs: record.runs,
    suggestions: record.suggestions,
    deliveries: record.deliveries,
  };
  const sources = state.sources.map((source) => record.sources.find((entry) => entry.id === source.id) ?? source);
  const added = record.sources.filter((source) => !state.sources.some((entry) => entry.id === source.id));
  return { ...withProduction(state, next), sources: [...sources, ...added] };
}

export type RecordAccess = ReturnType<typeof createRecordAccess>;

export function createRecordAccess(store: LocalStore) {
  function apply(productionId: ProductionId, transform: RecordTransform, options: ApplyOptions = {}): Result<ProductionRecord, 'not_found'> {
    const result = store.transact(
      (state, ctx): Tx<ProductionRecord, 'not_found'> => {
        const production = findProduction(state, productionId);
        if (!production) return refuse('not_found', 'Não encontramos esta produção.');
        const before = assembleRecord(state, production);
        const after = transform(before, ctx);
        const runFolds = options.runFold ? { ...state.runFolds, [options.runFold.run.id]: options.runFold } : state.runFolds;
        if (after === before || sameContent(before, after)) {
          // Stream progress without visible change (text deltas): keep the snapshot, stay quiet.
          return ok({ state: { ...state, runFolds }, value: before, persist: options.runFold ? 'deferred' : 'none', silent: true });
        }
        const activity = activityBetween(before, after);
        return ok({
          state: { ...writeBack(state, after), runFolds },
          value: after,
          productionIds: [productionId],
          activity,
          persist: options.persist ?? (activity.length > 0 ? 'full' : 'deferred'),
          scope: 'runs',
        });
      },
      options.actorId === undefined ? {} : { actorId: options.actorId },
    );
    return result.ok ? ok(structuredClone(result.value)) : result;
  }

  function productionsWithActiveRuns(): ProductionId[] {
    return store.state.productions.filter((entry) => entry.runs.some(isRunActive)).map((entry) => entry.production.id);
  }

  return {
    /** Current record of a production (a copy; e.g. `LocalGenerationDeps.getRecord`). */
    record(productionId: ProductionId): ProductionRecord | undefined {
      const production = findProduction(store.state, productionId);
      return production ? structuredClone(assembleRecord(store.state, production)) : undefined;
    },
    apply,
    /** Persisted stream snapshots (for reload recovery and attach after a reload). */
    runFolds(): Record<RunId, RunFold> {
      return structuredClone(store.state.runFolds);
    },
    /** Productions with runs still marked active (after a reload: orphans to recover). */
    productionsWithActiveRuns,
    /**
     * Applies a recovery function (e.g. generation's `recoverOrphanRuns`) to every production
     * with active runs; returns the productions it changed.
     */
    recover(recoverRecord: (record: ProductionRecord, folds: Readonly<Record<RunId, RunFold>>, ctx: CommandContext) => ProductionRecord): ProductionId[] {
      const changed: ProductionId[] = [];
      for (const productionId of productionsWithActiveRuns()) {
        const before = store.state.productions.find((entry) => entry.production.id === productionId);
        const result = apply(productionId, (record, ctx) => recoverRecord(record, store.state.runFolds, ctx), { persist: 'full' });
        const after = store.state.productions.find((entry) => entry.production.id === productionId);
        if (result.ok && before !== after) changed.push(productionId);
      }
      return changed;
    },
  };
}
