import type { ActorId, PieceId, ProductionId, RunId, StepId, SuggestionId } from '../../../domain/ids.ts';
import { sliceText } from '../../../domain/article.ts';
import { bodyHash, toVersionRef } from '../../../domain/piece.ts';
import type { Piece, PieceBody, PieceKind, Version } from '../../../domain/piece.ts';
import { pieceOfKind } from '../../../domain/record.ts';
import { dedupeRefs } from '../../../domain/refs.ts';
import type { Ref, SourceVersionRef, TextRange, VersionRef } from '../../../domain/refs.ts';
import { ok, refuse } from '../../../domain/result.ts';
import type { CommandContext } from '../../../domain/result.ts';
import { articleBodyFromRun, hasUsableOutput } from '../../../domain/run-events.ts';
import type { RunFold } from '../../../domain/run-events.ts';
import { isRunActive, SIMULATED_MODEL } from '../../../domain/run.ts';
import type { GenerationRun, ModelInfo, PromptRef, RunError, RunKind } from '../../../domain/run.ts';
import { canGenerate } from '../../../domain/rules/generate.ts';
import { stableStringify } from '../../../domain/text/hash.ts';
import type { GenerateRefusal } from '../../../domain/rules/generate.ts';
import { isDraftDirty, saveVersion, settleGeneration } from '../../../domain/rules/versions.ts';
import type { Suggestion, SuggestionProposal } from '../../../domain/suggestion.ts';
import type { ActivityDraft, LocalStore, Tx } from './local-store.ts';
import { assembleRecord, findProduction, locatePiece, locateRun, withPiece, withProduction } from './state.ts';
import type { ProductionState, StoreState } from './state.ts';

/**
 * Run ledger: the write path of generation adapters (simulated now, provider later). It enforces
 * `canGenerate`, records the run's inputs (REQ-1.2), freezes a dirty draft before a
 * regeneration, keeps the stream snapshot for `attach`, and settles runs into versions with
 * `settleGeneration` (v1 · IA stays pure; edits made while streaming become a separate version).
 */

/** Runs whose output becomes a piece version. Other kinds produce suggestions or child sections. */
export const VERSIONING_RUN_KINDS: readonly RunKind[] = ['article.generate', 'carousel.generate'];

export type BeginRunInput = {
  productionId: ProductionId;
  kind: RunKind;
  prompt: PromptRef;
  steps: { id: StepId; label: string }[];
  /** Defaults to "Simulação local". */
  model?: ModelInfo;
  /** Section runs are children of the article run (retry one section alone). */
  parentRunId?: RunId;
  retryOfRunId?: RunId;
  /** Extra context to record on top of the rule's inputs (segments used, selection…). */
  extraInputs?: Ref[];
};

export type BeginRunRefusal = GenerateRefusal | 'not_found' | 'parent_not_active';

export type SettleOutcome = {
  status: 'completed' | 'failed' | 'cancelled';
  error?: RunError;
  /** Final body; defaults to the body rebuilt from the stream snapshot. */
  output?: PieceBody;
  fold?: RunFold;
};

export type SettledRun = { run: GenerationRun; versions: Version[] };

export type SuggestionInput = {
  id?: SuggestionId;
  runId: RunId;
  pieceId: PieceId;
  target: TextRange[];
  proposal: SuggestionProposal;
  label?: string;
  state?: 'streaming' | 'ready' | 'error';
};

function pieceKindOf(kind: RunKind): PieceKind {
  return kind.startsWith('carousel.') ? 'carousel' : 'article';
}

function hasContent(body: PieceBody): boolean {
  return body.type === 'article' ? body.blocks.length > 0 : body.slides.length > 0;
}

function bodyFromFold(piece: Piece, fold: RunFold | undefined, includePartial: boolean): PieceBody | undefined {
  if (!fold) return undefined;
  if (piece.kind === 'carousel' && piece.draft.body.type === 'carousel') {
    return { type: 'carousel', templateId: piece.draft.body.templateId, slides: fold.slides };
  }
  return articleBodyFromRun(fold, { includePartial });
}

/** What screens show of a running run (steps, status, usage); text deltas are not part of it. */
function visibleState(run: GenerationRun): unknown {
  return { status: run.status, steps: run.steps, usage: run.usage, cost: run.cost, error: run.error };
}

function withRun(production: ProductionState, run: GenerationRun): ProductionState {
  return { ...production, runs: production.runs.map((entry) => (entry.id === run.id ? run : entry)) };
}

function versionCreated(production: ProductionState, piece: Piece, version: Version): ActivityDraft {
  return {
    type: 'version.created',
    productionId: production.production.id,
    subject: toVersionRef(version),
    data: { piece: piece.kind, number: version.number, origin: version.origin, ...(version.interrupted ? { interrupted: true } : {}) },
  };
}

function finalSteps(run: GenerationRun, status: SettleOutcome['status'], at: string): GenerationRun['steps'] {
  const state = status === 'completed' ? 'done' : status === 'failed' ? 'error' : 'skipped';
  return run.steps.map((step) => (step.state === 'current' || step.state === 'awaiting_input' ? { ...step, state, endedAt: at } : step));
}

function settleIn(state: StoreState, runId: RunId, outcome: SettleOutcome, ctx: CommandContext): Tx<SettledRun, 'not_found' | 'not_active'> {
  const production = locateRun(state, runId);
  const run = production?.runs.find((entry) => entry.id === runId);
  if (!production || !run) return refuse('not_found', 'Geração não encontrada.');
  if (!isRunActive(run)) return refuse('not_active', 'Esta geração já terminou.');
  const fold = outcome.fold ?? state.runFolds[runId];
  const endedAt = fold?.run.endedAt ?? ctx.now;
  const settled: GenerationRun = {
    ...run,
    ...(fold ? { steps: fold.run.steps } : {}),
    ...(fold?.run.usage ? { usage: fold.run.usage } : {}),
    ...(fold?.run.cost ? { cost: fold.run.cost } : {}),
    status: outcome.status,
    endedAt,
  };
  settled.steps = finalSteps(settled, outcome.status, endedAt);
  const error = outcome.error ?? fold?.run.error;
  if (error && outcome.status === 'failed') settled.error = error;

  let next = production;
  const versions: Version[] = [];
  const activity: ActivityDraft[] = [];
  const piece = run.pieceId ? production.pieces.find((entry) => entry.id === run.pieceId) : undefined;
  if (piece && VERSIONING_RUN_KINDS.includes(run.kind) && !run.parentRunId) {
    const body = outcome.output ?? bodyFromFold(piece, fold, outcome.status !== 'completed');
    const usable =
      body !== undefined &&
      hasContent(body) &&
      (outcome.status === 'completed' || outcome.output !== undefined || (fold !== undefined && hasUsableOutput(fold)));
    if (body && usable) {
      const result = settleGeneration(
        {
          piece,
          versions: production.versions,
          output: body,
          runId,
          runStartedAt: run.startedAt ?? run.createdAt,
          interrupted: outcome.status !== 'completed',
          inputs: run.inputs.filter((ref): ref is VersionRef => ref.kind === 'version'),
          sources: run.inputs.filter((ref): ref is SourceVersionRef => ref.kind === 'source-version'),
        },
        ctx,
      );
      versions.push(...result.versions);
      settled.output = toVersionRef(result.versions[0]);
      next = { ...withPiece(next, result.piece), versions: [...next.versions, ...result.versions] };
      for (const version of result.versions) activity.push(versionCreated(next, piece, version));
    }
  }
  next = {
    ...withRun(next, settled),
    suggestions: next.suggestions.map((entry) =>
      entry.runId === runId && entry.state === 'streaming' ? { ...entry, state: outcome.status === 'completed' ? 'ready' : 'error' } : entry,
    ),
  };
  if (!run.parentRunId) {
    activity.unshift({ type: `run.${outcome.status}`, productionId: production.production.id, actorId: run.createdBy, data: { runKind: run.kind } });
  }
  const runFolds = fold ? { ...state.runFolds, [runId]: { ...fold, run: settled } } : state.runFolds;
  return ok({
    state: { ...withProduction(state, next), runFolds },
    value: { run: settled, versions },
    productionIds: [production.production.id],
    activity,
    scope: 'runs',
  });
}

export type RunLedger = ReturnType<typeof createRunLedger>;

export function createRunLedger(store: LocalStore) {
  function begin(input: BeginRunInput, actorId?: ActorId) {
    return store.transact(
      (state, ctx): Tx<{ run: GenerationRun; frozen?: Version }, BeginRunRefusal> => {
        const production = findProduction(state, input.productionId);
        if (!production) return refuse('not_found', 'Não encontramos esta produção.');
        const record = assembleRecord(state, production);
        const piece = pieceOfKind(record, pieceKindOf(input.kind));
        let inputs: Ref[];
        if (input.parentRunId) {
          const parent = production.runs.find((run) => run.id === input.parentRunId);
          if (!parent || !isRunActive(parent)) return refuse('parent_not_active', 'A geração principal não está em andamento.');
          inputs = parent.inputs;
        } else {
          const allowed = canGenerate(record, pieceKindOf(input.kind));
          if (!allowed.ok) return allowed;
          inputs = allowed.value.inputs;
        }
        if (!piece) return refuse('not_found', 'Crie a peça antes de gerar.');

        let next = production;
        let frozen: Version | undefined;
        const activity: ActivityDraft[] = [];
        const versioning = VERSIONING_RUN_KINDS.includes(input.kind) && !input.parentRunId;
        const latest = record.versions
          .filter((version) => version.pieceId === piece.id)
          .sort((a, b) => a.number - b.number)
          .pop();
        if (versioning && hasContent(piece.draft.body) && isDraftDirty(piece, latest)) {
          const saved = saveVersion(piece, record.versions, ctx);
          if (saved.ok) {
            frozen = saved.value.version;
            next = { ...withPiece(next, saved.value.piece), versions: [...next.versions, frozen] };
            activity.push(versionCreated(next, piece, frozen));
          }
        }
        const run: GenerationRun = {
          id: ctx.newId('run'),
          kind: input.kind,
          productionId: production.production.id,
          pieceId: piece.id,
          prompt: input.prompt,
          model: input.model ?? SIMULATED_MODEL,
          inputs: dedupeRefs([...inputs, ...(input.extraInputs ?? [])]),
          status: 'running',
          steps: input.steps.map((step) => ({ id: step.id, label: step.label, state: 'upcoming' as const })),
          createdBy: ctx.actorId,
          createdAt: ctx.now,
          startedAt: ctx.now,
        };
        if (input.parentRunId) run.parentRunId = input.parentRunId;
        if (input.retryOfRunId) run.retryOfRunId = input.retryOfRunId;
        next = { ...next, runs: [...next.runs, run] };
        if (!input.parentRunId) activity.push({ type: 'run.started', productionId: production.production.id, data: { runKind: run.kind } });
        return ok({
          state: withProduction(state, next),
          value: frozen ? { run, frozen } : { run },
          productionIds: [production.production.id],
          activity,
          scope: 'runs',
        });
      },
      actorId === undefined ? {} : { actorId },
    );
  }

  function settle(runId: RunId, outcome: SettleOutcome) {
    return store.transact((state, ctx) => settleIn(state, runId, outcome, ctx));
  }

  /**
   * Stores the stream snapshot (steps, completed blocks, partial text) for `attach` and reload
   * recovery. Writes are coalesced; call it at step/block boundaries rather than per delta.
   * A terminal fold settles the run.
   */
  function sync(fold: RunFold) {
    const runId = fold.run.id;
    const current = locateRun(store.state, runId)?.runs.find((run) => run.id === runId);
    if (current && isRunActive(current) && !isRunActive(fold.run)) {
      const status = fold.run.status === 'completed' ? 'completed' : fold.run.status === 'failed' ? 'failed' : 'cancelled';
      return settle(runId, { status, fold });
    }
    return store.transact((state): Tx<SettledRun, 'not_found' | 'not_active'> => {
      const production = locateRun(state, runId);
      const run = production?.runs.find((entry) => entry.id === runId);
      if (!production || !run) return refuse('not_found', 'Geração não encontrada.');
      if (!isRunActive(run)) return refuse('not_active', 'Esta geração já terminou.');
      const synced: GenerationRun = { ...run, status: fold.run.status, steps: fold.run.steps };
      if (fold.run.usage) synced.usage = fold.run.usage;
      if (fold.run.cost) synced.cost = fold.run.cost;
      if (fold.run.error) synced.error = fold.run.error;
      // Text deltas only grow the snapshot: keep it (coalesced write) without waking every screen.
      const visible = stableStringify(visibleState(synced)) !== stableStringify(visibleState(run));
      return ok({
        state: {
          ...(visible ? withProduction(state, withRun(production, synced)) : state),
          runFolds: { ...state.runFolds, [runId]: fold },
        },
        value: { run: visible ? synced : run, versions: [] },
        productionIds: [production.production.id],
        persist: 'deferred',
        scope: 'runs',
        silent: !visible,
      });
    });
  }

  /** Creates or updates an AI suggestion; anchors are captured from the current draft. */
  function putSuggestion(input: SuggestionInput) {
    return store.transact((state, ctx): Tx<Suggestion, 'not_found'> => {
      const location = locatePiece(state, input.pieceId);
      if (!location) return refuse('not_found', 'Não encontramos esta peça.');
      const existing = input.id ? location.production.suggestions.find((entry) => entry.id === input.id) : undefined;
      const body = location.piece.draft.body;
      const suggestion: Suggestion = existing
        ? { ...existing, proposal: input.proposal, state: input.state ?? existing.state, ...(input.label ? { label: input.label } : {}) }
        : {
            id: input.id ?? ctx.newId('sug'),
            runId: input.runId,
            pieceId: input.pieceId,
            baseRevision: location.piece.draft.revision,
            target: input.target,
            anchorText: input.target.map((range) => (body.type === 'article' ? (sliceText(body, range) ?? '') : '')),
            proposal: input.proposal,
            state: input.state ?? 'ready',
            createdAt: ctx.now,
            ...(input.label ? { label: input.label } : {}),
          };
      const suggestions = existing
        ? location.production.suggestions.map((entry) => (entry.id === suggestion.id ? suggestion : entry))
        : [...location.production.suggestions, suggestion];
      return ok({
        state: withProduction(state, { ...location.production, suggestions }),
        value: suggestion,
        productionIds: [location.production.production.id],
        persist: 'deferred',
        scope: 'runs',
      });
    });
  }

  /**
   * After a reload nothing drives runs that were streaming: they become "interrompida" with the
   * partial output kept (child runs first, then their parents).
   */
  function recoverOrphanedRuns(): RunId[] {
    const active = store.state.productions.flatMap((production) => production.runs.filter(isRunActive));
    const ordered = [...active.filter((run) => run.parentRunId), ...active.filter((run) => !run.parentRunId)];
    const recovered: RunId[] = [];
    for (const run of ordered) {
      const result = settle(run.id, { status: 'cancelled' });
      if (result.ok) recovered.push(run.id);
    }
    return recovered;
  }

  return {
    begin,
    sync,
    settle,
    putSuggestion,
    recoverOrphanedRuns,
    /** Latest stream snapshot (the `attach` snapshot after a reload); deep copy. */
    fold: (runId: RunId): RunFold | undefined => {
      const fold = store.state.runFolds[runId];
      return fold ? structuredClone(fold) : undefined;
    },
    run: (runId: RunId): GenerationRun | undefined => {
      const run = locateRun(store.state, runId)?.runs.find((entry) => entry.id === runId);
      return run ? structuredClone(run) : undefined;
    },
    /** Hash of a piece's current draft, so adapters can tell whether a person edited it. */
    draftHash: (pieceId: PieceId): string | undefined => {
      const location = locatePiece(store.state, pieceId);
      return location ? bodyHash(location.piece.draft.body) : undefined;
    },
  };
}
