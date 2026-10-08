import type { ArticleBody } from '../domain/article.ts';
import type { CarouselBody, SlideAssistAction } from '../domain/carousel.ts';
import type { BlockId, PieceId, ProductionId, RunId, SlideId, StepId, TemplateId } from '../domain/ids.ts';
import type { SourceRef, TextRange, VersionRef } from '../domain/refs.ts';
import type { Result } from '../domain/result.ts';
import type { RunEvent, RunFold } from '../domain/run-events.ts';
import type { ArticleSize } from '../domain/sizing.ts';
import type { ModelInfo, RunKind } from '../domain/run.ts';
import type { GenerateRefusal } from '../domain/rules/generate.ts';
import type { Unsubscribe } from './common.ts';

/**
 * Generation port (F1.2, REQ-1.2, REQ-T.3/T.4). A run is started with a typed request, streams
 * `RunEvent`s (interpreted only by the domain `foldRun`) and settles into versions/suggestions.
 * The local adapter simulates it in the browser ("Simulação local"); a provider adapter will map
 * AI SDK stream parts onto the same events without touching screens.
 */

/** What can be requested. Each maps onto a domain `RunKind` for provenance. */
export type GenerationKind =
  | 'article.outline'
  | 'article.draft'
  | 'article.rewrite'
  | 'article.shorten'
  | 'article.expand-from-source'
  | 'article.to-list'
  | 'article.titles'
  | 'article.subheadings'
  | 'article.ask'
  | 'article.apply-note'
  | 'carousel.copy'
  | 'carousel.assist';

export const GENERATION_KINDS: readonly GenerationKind[] = [
  'article.outline',
  'article.draft',
  'article.rewrite',
  'article.shorten',
  'article.expand-from-source',
  'article.to-list',
  'article.titles',
  'article.subheadings',
  'article.ask',
  'article.apply-note',
  'carousel.copy',
  'carousel.assist',
];

/** pt-BR action labels (menu items, run titles, suggestion cards). */
export const GENERATION_LABELS: Record<GenerationKind, string> = {
  'article.outline': 'Montar estrutura',
  'article.draft': 'Gerar artigo',
  'article.rewrite': 'Reescrever',
  'article.shorten': 'Encurtar',
  'article.expand-from-source': 'Expandir com a fonte',
  'article.to-list': 'Virar lista',
  'article.titles': 'Títulos alternativos',
  'article.subheadings': 'Sugerir intertítulos',
  'article.ask': 'Perguntar à IA',
  'article.apply-note': 'Aplicar nota da revisão',
  'carousel.copy': 'Gerar textos do carrossel',
  'carousel.assist': 'Ajustar slide',
};

/** pt-BR labels of the slide actions (suggestion cards, run titles). */
export const SLIDE_ASSIST_LABELS: Record<SlideAssistAction, string> = {
  rewrite: 'Reescrever',
  fit: 'Encurtar para caber',
  swap: 'Trocar ponto',
  update: 'Atualizar slide',
};

export const RUN_KIND_OF: Record<GenerationKind, RunKind> = {
  'article.outline': 'article.outline',
  'article.draft': 'article.generate',
  'article.rewrite': 'article.assist',
  'article.shorten': 'article.assist',
  'article.expand-from-source': 'article.assist',
  'article.to-list': 'article.assist',
  'article.titles': 'article.titles',
  'article.subheadings': 'article.assist',
  'article.ask': 'article.assist',
  'article.apply-note': 'article.assist',
  'carousel.copy': 'carousel.generate',
  'carousel.assist': 'carousel.assist',
};

export type RewriteTone = 'direct' | 'didactic' | 'formal';

export const REWRITE_TONES: readonly RewriteTone[] = ['direct', 'didactic', 'formal'];

export const REWRITE_TONE_LABELS: Record<RewriteTone, string> = {
  direct: 'Mais direto',
  didactic: 'Didático',
  formal: 'Formal',
};

// ── Requests ─────────────────────────────────────────────────────────────────────────────

/**
 * "Montar estrutura" (Nova produção, step 3): proposes the article's structure from the material
 * and the brief, without writing it. The run's outline (`outlineProposalOf(fold)`) holds the
 * proposal; it creates no version and does not change the piece's state. Runs again on demand.
 */
export type ArticleOutlineInput = { productionId: ProductionId; pieceId: PieceId };

/** A section of a reviewed structure; without `blockId` it was added by the person. */
export type OutlineSectionInput = { blockId?: BlockId; title: string; quotes: SourceRef[] };

/**
 * The structure a person reviewed: the article's title, the lines the introduction opens with and
 * the sections in order, each with its intertítulo and the lines of the interview it is written
 * from. Sections may be renamed, reordered, removed or added; a quote belongs to one place only.
 */
export type OutlineInput = {
  title: string;
  intro?: { quotes: SourceRef[] };
  sections: OutlineSectionInput[];
  /** The outline run it came from (provenance only). */
  fromRunId?: RunId;
};

/**
 * Full article draft from the production's material and brief (recipe "aqui pedrão"). With
 * `outline`, the sections are written in the given order from the given quotes ("Redigir artigo").
 */
export type ArticleDraftInput = { productionId: ProductionId; pieceId: PieceId; outline?: OutlineInput };

/**
 * The size contract of "Gerar artigo" (João's lauda rule), as data a provider adapter turns into
 * its prompt and the simulated adapter follows: aim at `targetChars` (± `tolerance`), never above
 * `maxChars`, and never pad. When the material gives less, the draft comes out shorter: no
 * repeated facts or quotes, no context without a source in the material, no interviewer
 * questions as text, no adjectives to fill space. Built from the brief by
 * `draftSizeInstructions` (registries/sizing.ts).
 */
export type DraftSizeInstructions = {
  size: ArticleSize;
  laudas: number;
  charsPerLauda: number;
  minChars: number;
  maxChars: number;
  targetChars: number;
  /** Share of the target a draft may land around; the maximum still holds. */
  tolerance: number;
  /** Sections become H2 intertítulos (Padrão); in a Curto they only guide the drafting. */
  headings: boolean;
  neverPad: true;
  /** Character budget of the introduction. */
  introChars: number;
  /** Character budget per section, in order (`section-1`…, matching the recipe steps). */
  sections: { stepId: StepId; budgetChars: number }[];
  /** The sentence the model receives: "Escreva até 4.000 caracteres; se o material não sustentar, escreva menos e não complete." */
  instruction: string;
};

/**
 * Inline action on a selection. `body` is the editor's draft at `baseRevision`; `target` holds
 * ranges inside its blocks (one range for text actions). The document never changes while the
 * suggestion streams: the result is a `Suggestion` the person accepts or discards.
 */
export type SelectionInput = {
  productionId: ProductionId;
  pieceId: PieceId;
  baseRevision: number;
  body: ArticleBody;
  target: TextRange[];
};

export type RewriteInput = SelectionInput & { tone: RewriteTone };

/**
 * "Encurtar": a selection, or the whole document when `target` is empty (one suggestion per
 * paragraph, longest first, until the body reaches `targetCharacters`: "Encurtar para 2 laudas"
 * asks for the size's maximum, 4.000 characters).
 */
export type ShortenInput = Omit<SelectionInput, 'target'> & { target?: TextRange[]; targetCharacters?: number };

export type TitlesInput = { productionId: ProductionId; pieceId: PieceId; baseRevision: number; body: ArticleBody };

/** Free question to the copilot; with a selection it may also return a suggestion. */
export type AskInput = TitlesInput & { prompt: string; target?: TextRange[] };

/**
 * "Aplicar nota com IA" after "Ajustes solicitados": one suggestion per passage the reviewer
 * pointed at (`anchors`, as they are in `body` now), guided by the note.
 */
export type ApplyNoteInput = TitlesInput & { note: string; anchors: TextRange[] };

export type CarouselCopyInput = {
  productionId: ProductionId;
  /** The carousel piece (created by `ProductionCommands.derive`). */
  pieceId: PieceId;
  /** Approved article version to write from; defaults to the latest approved one. */
  from?: VersionRef;
  /** Must match the piece's template (chosen at `derive`); defaults to it. */
  templateId?: TemplateId;
  /** Number of slides (template min/max); default 5: Capa · Contexto · Ponto principal · Citação · Conclusão. */
  slides?: number;
};

/**
 * A slide action of the carousel studio. `body` is the studio's draft at `baseRevision`;
 * `slideIds` holds the slide to work on (rewrite · fit · swap) or is empty for `update` (one
 * proposal per slide whose article blocks changed in the newly approved version). Proposals are
 * `Suggestion`s with proposal kind `slide`, decided like the article's.
 */
export type CarouselAssistInput = {
  productionId: ProductionId;
  pieceId: PieceId;
  baseRevision: number;
  body: CarouselBody;
  action: SlideAssistAction;
  slideIds: SlideId[];
};

export type GenerationInputs = {
  'article.outline': ArticleOutlineInput;
  'article.draft': ArticleDraftInput;
  'article.rewrite': RewriteInput;
  'article.shorten': ShortenInput;
  'article.expand-from-source': SelectionInput;
  'article.to-list': SelectionInput;
  'article.titles': TitlesInput;
  'article.subheadings': TitlesInput;
  'article.ask': AskInput;
  'article.apply-note': ApplyNoteInput;
  'carousel.copy': CarouselCopyInput;
  'carousel.assist': CarouselAssistInput;
};

export type GenerationRequest = { [K in GenerationKind]: { kind: K; input: GenerationInputs[K] } }[GenerationKind];

export type StartOptions = {
  /** Model alias from `models()`; defaults to the first one. */
  modelAlias?: string;
  /** Aborting the signal is the same as `cancel(runId)`. */
  signal?: AbortSignal;
  /** Simulation scenario id from `scenarios()` (failures, pauses); provider adapters ignore it. */
  simulation?: string;
  /** Pause after "Montando estrutura" until `resume()` (REQ-3.8 plug, off by default in R1). */
  reviewOutline?: boolean;
};

export type StartRefusal =
  | GenerateRefusal
  | 'unknown_production'
  | 'unknown_piece'
  | 'unknown_model'
  | 'unknown_template'
  | 'invalid_target'
  | 'no_source'
  | 'no_change'
  | 'material_too_short'
  | 'empty_prompt'
  /** The reviewed structure cannot be written (section count, an empty intertítulo, a quote twice…). */
  | 'invalid_outline'
  /** The piece waits for approval: its text is locked until the request is withdrawn or decided. */
  | 'locked';

// ── Runs ─────────────────────────────────────────────────────────────────────────────────

/** Request context of a run: what screens and the store need beyond the event stream. */
export type RunMeta = {
  runId: RunId;
  productionId: ProductionId;
  pieceId: PieceId;
  request: GenerationRequest;
  /** pt-BR label for the copilot turn / toast: "Mais direto", "Geração do artigo". */
  label: string;
  /** Present on child runs (one per article section), which are retried through the parent. */
  child?: { parentRunId: RunId; stepId: StepId };
  /**
   * `false` when `retry` cannot continue this run: a run of an earlier session whose material or
   * brief changed since (`plan_changed`); offer "Gerar nova versão" instead. Omitted otherwise.
   */
  canRetry?: false;
};

/** Everything a subscriber needs after each event: the event, the folded state and the request. */
export type RunUpdate = { event: RunEvent; fold: RunFold; meta: RunMeta };

export type RunListener = (update: RunUpdate) => void;

export type RunSnapshot = { meta: RunMeta; fold: RunFold };

/**
 * `snapshot` is the folded state at attach time (steps + finished blocks + partial text). Live
 * events after `snapshot.seq` follow only within the session that owns the run. A finished run
 * of an earlier session (after a reload, or seeded) attaches from its persisted snapshot, ended,
 * and can be retried from a step like a live one; never a delta replay.
 */
export type RunAttachment = {
  meta: RunMeta;
  snapshot: RunFold;
  /** Live events after the snapshot; ends after the terminal event. */
  events: AsyncIterable<RunEvent>;
  /** Callback form of `events`; returns the unsubscribe function. */
  subscribe(listener: RunListener): Unsubscribe;
};

export type AttachRefusal = 'unknown_run';
export type CancelRefusal = 'unknown_run' | 'not_running';
export type ResumeRefusal = 'unknown_run' | 'not_awaiting' | 'invalid_input';
/** `plan_changed`: the material or the brief changed since the run, so it cannot be continued. */
export type RetryRefusal = 'unknown_run' | 'still_running' | 'nothing_to_retry' | 'unknown_step' | 'plan_changed' | StartRefusal;

/** `awaiting_input` request kind for the outline review pause. */
export const OUTLINE_REVIEW = 'outline-review';

/**
 * `resume()` input for `OUTLINE_REVIEW` (the "Pausar para revisar a estrutura" simulation): the
 * `OutlineInput` shape, with the title and the quotes optional so the rename-only payload stays
 * valid. The paused run renames its title and sections (same count); a structure with other
 * sections or quotes is drafted with `start('article.draft', { outline })` instead.
 */
export type OutlineReviewInput = Omit<OutlineInput, 'title' | 'sections'> & {
  title?: string;
  sections: (Omit<OutlineSectionInput, 'quotes'> & { quotes?: SourceRef[] })[];
};

export type SimulationScenario = {
  id: string;
  /** pt-BR label for the ⌘K "Simulação" group. */
  label: string;
  kinds: GenerationKind[];
};

export interface GenerationService {
  models(): Promise<ModelInfo[]>;
  /** Simulation scenarios; provider adapters return an empty list. */
  scenarios(): readonly SimulationScenario[];
  /**
   * Validates and starts a run. The refusal says why nothing started (material not authorised,
   * selection gone, nothing to change…). `run.started` is already emitted when this resolves.
   */
  start<K extends GenerationKind>(
    kind: K,
    input: GenerationInputs[K],
    options?: StartOptions,
  ): Promise<Result<{ runId: RunId }, StartRefusal>>;
  attach(runId: RunId): Promise<Result<RunAttachment, AttachRefusal>>;
  /** Stops a run; the partial output stays in the fold ("interrompida"). */
  cancel(runId: RunId): Promise<Result<RunFold, CancelRefusal>>;
  /** Continues a run paused at `awaiting_input`. */
  resume(runId: RunId, input: unknown): Promise<Result<true, ResumeRefusal>>;
  /**
   * New run (`retryOfRunId`) that reuses the outputs of the steps before `fromStepId` and runs
   * the rest. Defaults to the first unfinished step ("Tentar de novo a partir desta etapa",
   * "Continuar de onde parou"). A child run id retries its section through the parent.
   */
  retry(runId: RunId, fromStepId?: StepId): Promise<Result<{ runId: RunId }, RetryRefusal>>;
  /** Runs known to this session, newest first ("Gerando agora"). */
  snapshots(filter?: { productionId?: ProductionId; activeOnly?: boolean }): RunSnapshot[];
  /** Every event of every run in this session (the store persists runs and settles outputs). */
  watch(listener: RunListener): Unsubscribe;
}
