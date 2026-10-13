import { setCover, sliceText } from '../../../domain/article.ts';
import type { ArticleBody } from '../../../domain/article.ts';
import type { CarouselBody } from '../../../domain/carousel.ts';
import type { PieceId, RunId, TemplateId } from '../../../domain/ids.ts';
import { toVersionRef } from '../../../domain/piece.ts';
import type { Piece, PieceBody } from '../../../domain/piece.ts';
import { latestVersion } from '../../../domain/record.ts';
import type { ProductionRecord } from '../../../domain/record.ts';
import type { SourceVersionRef, VersionRef } from '../../../domain/refs.ts';
import type { CommandContext } from '../../../domain/result.ts';
import { applyRunEvent, articleBodyFromRun } from '../../../domain/run-events.ts';
import type { RunFold } from '../../../domain/run-events.ts';
import { isRunActive } from '../../../domain/run.ts';
import type { GenerationRun } from '../../../domain/run.ts';
import { isDraftDirty, saveVersion, settleGeneration } from '../../../domain/rules/versions.ts';
import { isSuggestionStale } from '../../../domain/suggestion.ts';
import type { Suggestion } from '../../../domain/suggestion.ts';
import type { RunUpdate } from '../../../ports/generation.ts';

/**
 * How a production record absorbs generation (pure; the store persists the result through
 * `records.apply`). The rules are the domain's: a dirty draft is frozen before a regeneration,
 * "v1 · IA" is the pure run output (`settleGeneration`), a cancelled run keeps its partial, a
 * failed run keeps its finished blocks, and assist runs become `ready` suggestions. An outline
 * run ("Montar estrutura") is only recorded: its proposal lives in its stream snapshot.
 * Re-applying the same update is idempotent.
 */

function upsertRun(runs: readonly GenerationRun[], run: GenerationRun): GenerationRun[] {
  const index = runs.findIndex((candidate) => candidate.id === run.id);
  if (index < 0) return [...runs, run];
  const previous = runs[index];
  const merged = previous.output && !run.output ? { ...run, output: previous.output } : run;
  const next = runs.slice();
  next[index] = merged;
  return next;
}

function replacePiece(pieces: readonly Piece[], piece: Piece): Piece[] {
  return pieces.map((candidate) => (candidate.id === piece.id ? piece : candidate));
}

function runInputs(run: GenerationRun): { inputs: VersionRef[]; sources: SourceVersionRef[] } {
  return {
    inputs: run.inputs.filter((ref): ref is VersionRef => ref.kind === 'version'),
    sources: run.inputs.filter((ref): ref is SourceVersionRef => ref.kind === 'source-version'),
  };
}

/** Before a regeneration starts, unsaved edits become a version (never mistaken for streaming edits). */
function freezeDirtyDraft(record: ProductionRecord, pieceId: PieceId, ctx: CommandContext): ProductionRecord {
  const piece = record.pieces.find((candidate) => candidate.id === pieceId);
  if (!piece || !isDraftDirty(piece, latestVersion(record, piece.id))) return record;
  const saved = saveVersion(piece, record.versions, ctx);
  if (!saved.ok) return record;
  return { ...record, versions: [...record.versions, saved.value.version], pieces: replacePiece(record.pieces, saved.value.piece) };
}

function outputOf(fold: RunFold, templateId: TemplateId | undefined): PieceBody | undefined {
  const { run } = fold;
  if (run.kind === 'article.generate') {
    const body: ArticleBody = articleBodyFromRun(fold, { includePartial: run.status === 'cancelled' });
    return body.blocks.length > 0 ? body : undefined;
  }
  if (run.kind === 'carousel.generate' && templateId && fold.slides.length > 0) {
    const body: CarouselBody = { type: 'carousel', templateId, slides: fold.slides };
    return body;
  }
  return undefined;
}

/**
 * A run this tab is still driving, written back over a record another tab saved (that tab may
 * have closed it as "interrompida" when it opened): the live state wins.
 */
export function keepLiveRun(record: ProductionRecord, run: GenerationRun): ProductionRecord {
  return { ...record, runs: upsertRun(record.runs, run) };
}

/** Turns a finished draft/carousel run into versions ("v1 · IA", "v2 · interrompida"…). */
export function settleRun(record: ProductionRecord, fold: RunFold, ctx: CommandContext, templateId?: TemplateId): ProductionRecord {
  const { run } = fold;
  if (isRunActive(run) || !run.pieceId || run.parentRunId) return record;
  // Idempotent per outcome: the same end applied twice settles once. A run another tab closed as
  // "interrompida" while this one was still driving it settles again when it really completes.
  const interrupted = run.status !== 'completed';
  if (record.versions.some((version) => version.runId === run.id && version.origin === 'generation' && Boolean(version.interrupted) === interrupted)) return record;
  const piece = record.pieces.find((candidate) => candidate.id === run.pieceId);
  const generated = outputOf(fold, templateId ?? (piece?.draft.body.type === 'carousel' ? piece.draft.body.templateId : undefined));
  if (!piece || !generated || generated.type !== piece.draft.body.type) return record;
  // The cover is the person's choice, not model output: a regenerated text keeps it (and the
  // outline's cover suggestion is then moot).
  const cover = piece.draft.body.type === 'article' ? piece.draft.body.cover : undefined;
  const output: PieceBody = generated.type === 'article' && cover && !generated.cover ? setCover(generated, cover) : generated;
  const { inputs, sources } = runInputs(run);
  const settled = settleGeneration(
    {
      piece,
      versions: record.versions,
      output,
      runId: run.id,
      runStartedAt: run.startedAt ?? run.createdAt,
      interrupted: run.status !== 'completed',
      inputs,
      sources,
    },
    ctx,
  );
  const output0 = toVersionRef(settled.versions[0]);
  return {
    ...record,
    runs: record.runs.map((candidate) => (candidate.id === run.id ? { ...candidate, output: output0 } : candidate)),
    versions: [...record.versions, ...settled.versions],
    pieces: replacePiece(record.pieces, settled.piece),
  };
}

function suggestionsOf(record: ProductionRecord, update: RunUpdate, ctx: CommandContext): Suggestion[] {
  const { fold, meta } = update;
  const request = meta.request;
  // Drafts and slides become versions; "Montar estrutura" only proposes a structure (no output).
  if (request.kind === 'article.draft' || request.kind === 'carousel.copy' || request.kind === 'article.outline') return [];
  const baseBody = request.input.body;
  const piece = record.pieces.find((candidate) => candidate.id === meta.pieceId);
  const current = piece?.draft.body.type === 'article' ? piece.draft.body : undefined;
  /** What the suggestion replaces, as it was: text ranges of the article, slot texts of a slide. */
  const anchorOf = (entry: (typeof fold.suggestions)[number]): string[] => {
    if (baseBody.type === 'carousel') {
      if (entry.proposal.kind !== 'slide') return [];
      const proposal = entry.proposal;
      const slide = baseBody.slides.find((candidate) => candidate.id === proposal.slideId);
      return Object.keys(proposal.slots).map((slot) => slide?.slots[slot] ?? '');
    }
    return entry.target.map((range) => sliceText(baseBody, range) ?? '');
  };
  return fold.suggestions
    .filter((entry) => !record.suggestions.some((existing) => existing.id === entry.id))
    .map((entry) => {
      const suggestion: Suggestion = {
        id: entry.id,
        runId: fold.run.id,
        pieceId: meta.pieceId,
        baseRevision: request.input.baseRevision,
        target: entry.target,
        anchorText: anchorOf(entry),
        proposal: entry.proposal,
        state: 'ready',
        createdAt: ctx.now,
      };
      if (entry.label) suggestion.label = entry.label;
      if (current && piece && piece.draft.revision !== request.input.baseRevision && isSuggestionStale(current, suggestion)) {
        suggestion.state = 'stale';
      }
      return suggestion;
    });
}

/**
 * Applies one `GenerationService.watch` update to the production record. Runtime wiring:
 * `generation.watch((update) => records.apply(update.meta.productionId,
 *   (record, ctx) => applyRunUpdate(record, update, ctx), { runFold: update.fold }))`.
 */
export function applyRunUpdate(record: ProductionRecord, update: RunUpdate, ctx: CommandContext): ProductionRecord {
  const { event, fold, meta } = update;
  if (meta.productionId !== record.production.id) return record;
  let next: ProductionRecord = { ...record, runs: upsertRun(record.runs, fold.run) };
  if (meta.child) return next;

  const versioning = meta.request.kind === 'article.draft' || meta.request.kind === 'carousel.copy';
  if (event.type === 'run.started' && versioning) next = freezeDirtyDraft(next, meta.pieceId, ctx);

  if (event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled') {
    if (versioning) {
      const templateId = meta.request.kind === 'carousel.copy' ? meta.request.input.templateId : undefined;
      next = settleRun(next, fold, ctx, templateId);
    } else if (event.type === 'run.completed') {
      const created = suggestionsOf(next, update, ctx);
      if (created.length > 0) next = { ...next, suggestions: [...next.suggestions, ...created] };
    }
  }
  return next;
}

/**
 * After a reload, runs still marked active belong to no live session: they end "interrompida".
 * With the persisted stream snapshot the partial output is kept as a version; without it the
 * run just closes (the draft keeps what was autosaved). Signature of the store's
 * `records.recover(...)`.
 */
export function recoverOrphanRuns(record: ProductionRecord, folds: Readonly<Record<RunId, RunFold>>, ctx: CommandContext): ProductionRecord {
  let next = record;
  const orphans = [...record.runs.filter((run) => isRunActive(run) && run.parentRunId), ...record.runs.filter((run) => isRunActive(run) && !run.parentRunId)];
  for (const run of orphans) {
    const fold = folds[run.id];
    if (fold && isRunActive(fold.run)) {
      const cancelled = applyRunEvent(fold, { type: 'run.cancelled', runId: run.id, seq: fold.seq + 1, at: ctx.now, reason: 'Interrompida ao recarregar' });
      next = { ...next, runs: upsertRun(next.runs, cancelled.run) };
      next = settleRun(next, cancelled, ctx);
      continue;
    }
    const steps = run.steps.map((step) =>
      step.state === 'current' || step.state === 'awaiting_input' ? { ...step, state: 'skipped' as const, endedAt: ctx.now } : step,
    );
    next = { ...next, runs: upsertRun(next.runs, { ...run, status: 'cancelled', endedAt: ctx.now, steps }) };
  }
  return next;
}
