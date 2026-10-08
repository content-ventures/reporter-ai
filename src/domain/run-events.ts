import { blockText, normalizeInlines } from './article.ts';
import type { ArticleBlock, ArticleBody } from './article.ts';
import type { Slide } from './carousel.ts';
import type { ActorId, BlockId, IsoDateTime, PieceId, ProductionId, RunId, StepId, SuggestionId } from './ids.ts';
import { dedupeRefs } from './refs.ts';
import type { Ref, SourceRef, TextRange, VersionRef } from './refs.ts';
import type { Cost, GenerationRun, ModelInfo, PromptRef, RunError, RunKind, RunStep, Usage } from './run.ts';
import type { SuggestionProposal } from './suggestion.ts';

/**
 * Generation stream contract. Every event has a `seq` (strictly increasing per run); the pure
 * `foldRun` is the only interpreter. The shape mirrors AI SDK message parts (step / text delta
 * / source / data parts) so a provider adapter maps onto it without touching screens.
 */

type EventBase = { runId: RunId; seq: number; at: IsoDateTime };

export type StreamBlockShape = { id: BlockId; type: ArticleBlock['type']; level?: 2 | 3; ordered?: boolean };

export type RunStartedEvent = EventBase & {
  type: 'run.started';
  kind: RunKind;
  productionId: ProductionId;
  pieceId?: PieceId;
  parentRunId?: RunId;
  retryOfRunId?: RunId;
  prompt: PromptRef;
  model: ModelInfo;
  inputs: Ref[];
  steps: { id: StepId; label: string }[];
  createdBy: ActorId;
};

export type RunEvent =
  | RunStartedEvent
  | (EventBase & { type: 'step.started'; stepId: StepId; meta?: string })
  | (EventBase & { type: 'step.progress'; stepId: StepId; meta?: string })
  | (EventBase & { type: 'step.completed'; stepId: StepId; meta?: string })
  | (EventBase & { type: 'step.skipped'; stepId: StepId })
  | (EventBase & { type: 'step.failed'; stepId: StepId; error: RunError })
  | (EventBase & { type: 'step.awaiting_input'; stepId: StepId; request: AwaitingInputRequest })
  | (EventBase & { type: 'source.used'; ref: SourceRef })
  | (EventBase & { type: 'outline'; title?: string; sections: OutlineSection[] })
  | (EventBase & { type: 'block.started'; block: StreamBlockShape })
  | (EventBase & { type: 'text.delta'; blockId: BlockId; delta: string })
  | (EventBase & { type: 'block.completed'; block: ArticleBlock })
  | (EventBase & { type: 'slide.completed'; slide: Slide })
  | (EventBase & { type: 'suggestion'; suggestionId: SuggestionId; target: TextRange[]; proposal: SuggestionProposal; label?: string })
  | (EventBase & { type: 'usage'; usage: Usage; cost?: Cost })
  | (EventBase & { type: 'run.completed'; output?: VersionRef })
  | (EventBase & { type: 'run.failed'; error: RunError })
  | (EventBase & { type: 'run.cancelled'; reason?: string });

export type RunEventType = RunEvent['type'];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An event before the stream stamps it: what simulated and provider adapters emit. */
export type RunEventPayload = DistributiveOmit<RunEvent, 'runId' | 'seq' | 'at'>;

/** Stamps a payload with its run, the next sequence number and the Clock time. */
export function stampRunEvent(payload: RunEventPayload, runId: RunId, seq: number, at: IsoDateTime): RunEvent {
  return { ...payload, runId, seq, at };
}

/** Human-in-the-loop pause (R3 outline review, R4 segment picking); `resume(runId, input)` continues. */
export type AwaitingInputRequest = { kind: string; message: string; payload?: unknown };

export type OutlineSection = { blockId?: BlockId; title: string };

/** A block as seen by the stream: text grows by deltas; `final` arrives with `block.completed`. */
export type StreamBlock = StreamBlockShape & { text: string; complete: boolean; final?: ArticleBlock };

export type StreamSuggestion = { id: SuggestionId; target: TextRange[]; proposal: SuggestionProposal; label?: string };

/** Interpretation of a run's event stream. Also the SNAPSHOT `attach(runId)` returns. */
export type RunFold = {
  run: GenerationRun;
  /** Highest `seq` applied; later deltas with a lower or equal seq are ignored (idempotent replay). */
  seq: number;
  title?: string;
  outline: OutlineSection[];
  blocks: StreamBlock[];
  slides: Slide[];
  sourcesUsed: SourceRef[];
  /**
   * What the run announced itself (`source.used`: the key excerpts of "Selecionando falas-chave"),
   * without the evidence of the blocks it wrote. Absent in snapshots saved before it existed.
   */
  keyRefs?: SourceRef[];
  suggestions: StreamSuggestion[];
  awaiting?: { stepId: StepId; request: AwaitingInputRequest };
};

function setStep(steps: RunStep[], stepId: StepId, patch: Partial<RunStep>): RunStep[] {
  return steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step));
}

function finishOpenSteps(steps: RunStep[], state: RunStep['state'], at: IsoDateTime): RunStep[] {
  return steps.map((step) =>
    step.state === 'current' || step.state === 'awaiting_input' ? { ...step, state, endedAt: at } : step,
  );
}

function initialFold(event: RunStartedEvent): RunFold {
  const run: GenerationRun = {
    id: event.runId,
    kind: event.kind,
    productionId: event.productionId,
    prompt: event.prompt,
    model: event.model,
    inputs: event.inputs,
    status: 'running',
    steps: event.steps.map((step) => ({ id: step.id, label: step.label, state: 'upcoming' })),
    createdBy: event.createdBy,
    createdAt: event.at,
    startedAt: event.at,
  };
  if (event.pieceId) run.pieceId = event.pieceId;
  if (event.parentRunId) run.parentRunId = event.parentRunId;
  if (event.retryOfRunId) run.retryOfRunId = event.retryOfRunId;
  return { run, seq: event.seq, outline: [], blocks: [], slides: [], sourcesUsed: [], suggestions: [] };
}

/** Applies one event. Returns the same object when the event is ignored (wrong run, old seq). */
export function applyRunEvent(fold: RunFold, event: RunEvent): RunFold {
  if (event.runId !== fold.run.id || event.seq <= fold.seq) return fold;
  const next: RunFold = { ...fold, seq: event.seq };
  const run = { ...fold.run };
  next.run = run;
  const reopen = () => {
    if (run.status === 'awaiting_input' || run.status === 'queued') run.status = 'running';
    delete next.awaiting;
  };

  switch (event.type) {
    case 'run.started':
      return fold;
    case 'step.started':
      reopen();
      run.steps = setStep(run.steps, event.stepId, { state: 'current', startedAt: event.at, ...(event.meta ? { meta: event.meta } : {}) });
      break;
    case 'step.progress':
      run.steps = setStep(run.steps, event.stepId, event.meta ? { meta: event.meta } : {});
      break;
    case 'step.completed':
      reopen();
      run.steps = setStep(run.steps, event.stepId, { state: 'done', endedAt: event.at, ...(event.meta ? { meta: event.meta } : {}) });
      break;
    case 'step.skipped':
      run.steps = setStep(run.steps, event.stepId, { state: 'skipped' });
      break;
    case 'step.failed':
      run.steps = setStep(run.steps, event.stepId, { state: 'error', endedAt: event.at });
      run.error = { ...event.error, stepId: event.stepId };
      break;
    case 'step.awaiting_input':
      run.status = 'awaiting_input';
      run.steps = setStep(run.steps, event.stepId, { state: 'awaiting_input' });
      next.awaiting = { stepId: event.stepId, request: event.request };
      break;
    case 'source.used':
      next.sourcesUsed = dedupeRefs([...fold.sourcesUsed, event.ref]);
      next.keyRefs = dedupeRefs([...(fold.keyRefs ?? []), event.ref]);
      break;
    case 'outline':
      next.outline = event.sections;
      if (event.title !== undefined) next.title = event.title;
      break;
    case 'block.started':
      if (fold.blocks.some((block) => block.id === event.block.id)) break;
      next.blocks = [...fold.blocks, { ...event.block, text: '', complete: false }];
      break;
    case 'text.delta': {
      const exists = fold.blocks.some((block) => block.id === event.blockId);
      next.blocks = exists
        ? fold.blocks.map((block) =>
            block.id === event.blockId && !block.complete ? { ...block, text: block.text + event.delta } : block,
          )
        : [...fold.blocks, { id: event.blockId, type: 'paragraph', text: event.delta, complete: false }];
      break;
    }
    case 'block.completed': {
      const final = event.block;
      const streamed: StreamBlock = {
        id: final.id,
        type: final.type,
        ...(final.type === 'heading' ? { level: final.level } : {}),
        ...(final.type === 'list' ? { ordered: final.ordered } : {}),
        text: blockText(final),
        complete: true,
        final,
      };
      const exists = fold.blocks.some((block) => block.id === final.id);
      next.blocks = exists ? fold.blocks.map((block) => (block.id === final.id ? streamed : block)) : [...fold.blocks, streamed];
      if (final.sourceRefs) next.sourcesUsed = dedupeRefs([...next.sourcesUsed, ...final.sourceRefs]);
      break;
    }
    case 'slide.completed': {
      const exists = fold.slides.some((slide) => slide.id === event.slide.id);
      next.slides = exists
        ? fold.slides.map((slide) => (slide.id === event.slide.id ? event.slide : slide))
        : [...fold.slides, event.slide];
      break;
    }
    case 'suggestion': {
      const suggestion: StreamSuggestion = { id: event.suggestionId, target: event.target, proposal: event.proposal };
      if (event.label) suggestion.label = event.label;
      next.suggestions = [...fold.suggestions.filter((entry) => entry.id !== event.suggestionId), suggestion];
      break;
    }
    case 'usage':
      run.usage = event.usage;
      if (event.cost) run.cost = event.cost;
      break;
    case 'run.completed':
      run.status = 'completed';
      run.endedAt = event.at;
      run.steps = finishOpenSteps(run.steps, 'done', event.at);
      if (event.output) run.output = event.output;
      delete next.awaiting;
      break;
    case 'run.failed':
      run.status = 'failed';
      run.endedAt = event.at;
      run.error = event.error;
      run.steps = finishOpenSteps(run.steps, 'error', event.at);
      delete next.awaiting;
      break;
    case 'run.cancelled':
      run.status = 'cancelled';
      run.endedAt = event.at;
      run.steps = run.steps.map((step) =>
        step.state === 'current' || step.state === 'awaiting_input' ? { ...step, state: 'skipped', endedAt: event.at } : step,
      );
      delete next.awaiting;
      break;
  }
  return next;
}

/**
 * Folds a list of events (any order, duplicates allowed) into a run state. Without `initial`
 * the stream must contain `run.started`; with it, the fold continues from a snapshot.
 */
export function foldRun(events: readonly RunEvent[], initial?: RunFold): RunFold | undefined {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  let fold = initial;
  for (const event of ordered) {
    if (!fold) {
      if (event.type !== 'run.started') continue;
      fold = initialFold(event);
      continue;
    }
    fold = applyRunEvent(fold, event);
  }
  return fold;
}

/** Drops a trailing partial word so an interrupted block never ends mid-word. */
export function trimToWordBoundary(text: string): string {
  if (!text || /[\s.,;:!?…)"”»]$/.test(text)) return text.trimEnd();
  const cut = text.search(/\s\S*$/);
  return cut > 0 ? text.slice(0, cut).trimEnd() : '';
}

function partialToBlock(block: StreamBlock): ArticleBlock | undefined {
  const text = trimToWordBoundary(block.text);
  if (!text) return undefined;
  const inlines = normalizeInlines([{ text }]);
  if (block.type === 'heading') return { id: block.id, type: 'heading', level: block.level ?? 2, inlines, ai: 'unreviewed' };
  if (block.type === 'quote') return { id: block.id, type: 'quote', inlines, ai: 'unreviewed' };
  if (block.type === 'list') {
    return { id: block.id, type: 'list', ordered: block.ordered ?? false, items: text.split('\n').map((item) => normalizeInlines([{ text: item }])), ai: 'unreviewed' };
  }
  if (block.type === 'divider') return undefined;
  return { id: block.id, type: 'paragraph', inlines, ai: 'unreviewed' };
}

/**
 * "v1 · IA" is the pure run output rebuilt from events (never polluted by edits made while
 * streaming). With `includePartial`, an interrupted run keeps its partial blocks.
 */
export function articleBodyFromRun(fold: RunFold, options: { title?: string; includePartial?: boolean } = {}): ArticleBody {
  const blocks: ArticleBlock[] = [];
  for (const block of fold.blocks) {
    if (block.complete && block.final) blocks.push(block.final);
    else if (options.includePartial) {
      const partial = partialToBlock(block);
      if (partial) blocks.push(partial);
    }
  }
  return { type: 'article', title: (options.title ?? fold.title ?? '').trim(), blocks };
}

/** True when the run produced at least one complete block or slide worth keeping. */
export function hasUsableOutput(fold: RunFold): boolean {
  return fold.blocks.some((block) => block.complete || trimToWordBoundary(block.text).length > 0) || fold.slides.length > 0;
}
