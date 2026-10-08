import { blockText, normalizeInlines } from './article.ts';
import type { ArticleBlock, ArticleBody, ImageSlot } from './article.ts';
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
  /**
   * "Montando estrutura" (the first step after reading): the title, the introduction and the
   * sections with their character budget and the quotes each one is written from, the size the
   * draft aims at and, when the material cannot fill it, the shortfall; what the material gives
   * at most and the quotable lines a person may add ("Citações da entrevista"); for an article
   * without a cover, the cover suggestion. `edited`: the structure a person reviewed in Nova
   * produção, which the draft follows as given.
   */
  | (EventBase & {
      type: 'outline';
      title?: string;
      sections: OutlineSection[];
      intro?: OutlineIntro;
      cover?: ImageSlot;
      size?: OutlineSize;
      shortfall?: OutlineShortfall;
      materialChars?: number;
      candidates?: SourceRef[];
      edited?: OutlineEdited;
    })
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

export type OutlineSection = {
  /** The section's identity: its intertítulo block in a Padrão (a Curto writes no heading). */
  blockId?: BlockId;
  title: string;
  /** Characters this section is written to (`sectionBudget`); absent on runs before the lauda rule. */
  budget?: number;
  /** The lines of the interview the section is written from (its "citações"); absent on older runs. */
  quotes?: SourceRef[];
};

/** The introduction of a structure: its character budget and the lines it opens with (the lead). */
export type OutlineIntro = { budget: number; quotes: SourceRef[] };

/** The structure came from a person (Nova produção, "Estrutura"), proposed by an outline run. */
export type OutlineEdited = { fromRunId?: RunId };

/** The size a draft aims at, as the outline announced it (`ArticleSizeSpec` numbers). */
export type OutlineSize = { laudas: number; minChars: number; maxChars: number; targetChars: number };

/** The material cannot fill the size: the draft comes out with what it gives, never padded. */
export type OutlineShortfall = { reason: 'material'; expectedChars: number };

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
  /** The cover suggestion the outline announced (`ArticleBody.coverSlot` of the output). */
  coverSlot?: ImageSlot;
  /** The size the outline announced (absent on runs before the lauda rule and on other run kinds). */
  size?: OutlineSize;
  /** The outline said the material cannot fill the size. */
  shortfall?: OutlineShortfall;
  /** The introduction the outline announced (absent on runs before the outline-first rule). */
  intro?: OutlineIntro;
  /** Characters of the longest text the material supports ("O material rende ≈ 2,3 laudas"). */
  materialChars?: number;
  /** Quotable lines of the interview the structure may add. */
  candidates?: SourceRef[];
  /** The draft follows a structure a person reviewed. */
  edited?: OutlineEdited;
  blocks: StreamBlock[];
  slides: Slide[];
  sourcesUsed: SourceRef[];
  /**
   * What the run announced itself (`source.used`: the key excerpts of "Organizando fontes e citações"),
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
      if (event.cover) next.coverSlot = event.cover;
      if (event.size) next.size = event.size;
      if (event.shortfall) next.shortfall = event.shortfall;
      if (event.intro) next.intro = event.intro;
      if (event.materialChars !== undefined) next.materialChars = event.materialChars;
      if (event.candidates) next.candidates = event.candidates;
      if (event.edited) next.edited = event.edited;
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

/**
 * The structure a run proposed (Nova produção, "Estrutura"; "Ver estrutura" in the studio): the
 * probable title, the introduction and the sections with their budgets and quotes, the size and
 * what the material gives. A person edits it and sends it back as the draft's `outline`.
 */
export type OutlineProposal = {
  title: string;
  intro: OutlineIntro;
  sections: OutlineSection[];
  size?: OutlineSize;
  shortfall?: OutlineShortfall;
  materialChars?: number;
  candidates: SourceRef[];
};

/**
 * The proposal a run's outline announced, or undefined before "Montando estrutura" ends. Runs
 * from before the outline-first rule carry no introduction: its budget is what the size's
 * target leaves after the sections' budgets.
 */
export function outlineProposalOf(fold: RunFold): OutlineProposal | undefined {
  if (fold.outline.length === 0 && fold.title === undefined) return undefined;
  const sectionBudgets = fold.outline.map((section) => section.budget);
  const derived =
    fold.size && sectionBudgets.every((budget): budget is number => budget !== undefined)
      ? Math.max(0, fold.size.targetChars - sectionBudgets.reduce((sum, budget) => sum + budget, 0))
      : 0;
  const proposal: OutlineProposal = {
    title: fold.title ?? '',
    intro: fold.intro ? { budget: fold.intro.budget, quotes: [...fold.intro.quotes] } : { budget: derived, quotes: [] },
    sections: fold.outline.map((section) => ({ ...section, ...(section.quotes ? { quotes: [...section.quotes] } : {}) })),
    candidates: [...(fold.candidates ?? [])],
  };
  if (fold.size) proposal.size = fold.size;
  if (fold.shortfall) proposal.shortfall = fold.shortfall;
  if (fold.materialChars !== undefined) proposal.materialChars = fold.materialChars;
  return proposal;
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
  if (block.type === 'divider' || block.type === 'figure') return undefined;
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
  const body: ArticleBody = { type: 'article', title: (options.title ?? fold.title ?? '').trim(), blocks };
  if (fold.coverSlot) body.coverSlot = fold.coverSlot;
  return body;
}

/** True when the run produced at least one complete block or slide worth keeping. */
export function hasUsableOutput(fold: RunFold): boolean {
  return fold.blocks.some((block) => block.complete || trimToWordBoundary(block.text).length > 0) || fold.slides.length > 0;
}
