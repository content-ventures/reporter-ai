import type { ActorId, IsoDateTime, PieceId, ProductionId, RunId, StepId } from './ids.ts';
import type { Ref, VersionRef } from './refs.ts';

/**
 * A generation run records everything REQ-1.2 / REQ-T.3 / REQ-T.4 ask for: prompt key and
 * version, model, the exact inputs (source version, brief snapshot, parent version), steps,
 * output version, usage/cost when a provider reports them, and errors with retry lineage.
 */

export type RunKind =
  | 'article.generate'
  | 'article.section'
  | 'article.assist'
  | 'article.titles'
  | 'carousel.generate'
  | 'carousel.assist';

export const RUN_KIND_LABELS: Record<RunKind, string> = {
  'article.generate': 'Geração do artigo',
  'article.section': 'Escrita de seção',
  'article.assist': 'Assistente de texto',
  'article.titles': 'Títulos alternativos',
  'carousel.generate': 'Geração do carrossel',
  'carousel.assist': 'Assistente do carrossel',
};

export type RunStatus = 'queued' | 'running' | 'awaiting_input' | 'completed' | 'failed' | 'cancelled';

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: 'Na fila',
  running: 'Gerando',
  awaiting_input: 'Aguardando você',
  completed: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Interrompida',
};

export type StepState = 'upcoming' | 'current' | 'done' | 'error' | 'skipped' | 'awaiting_input';

export type RunStep = {
  id: StepId;
  label: string;
  state: StepState;
  /** Short live detail: "42 falas · 3 falantes", "seção 2 de 3". */
  meta?: string;
  startedAt?: IsoDateTime;
  endedAt?: IsoDateTime;
};

export type PromptRef = { key: string; version: string; hash: string };

export type ModelEngine = 'simulated' | 'provider';
export type ModelInfo = { alias: string; label: string; engine: ModelEngine };

/** The only model in the frontend-only phase. It is always labelled, never disguised. */
export const SIMULATED_MODEL: ModelInfo = { alias: 'local-simulation', label: 'Simulação local', engine: 'simulated' };

export type Usage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };

/** Simulated runs never carry cost: numbers appear only when a provider reports them. */
export type Cost = { usd: number; source: 'estimate' | 'provider' };

export type RunError = {
  code: string;
  /** pt-BR message for the failed step. */
  message: string;
  retryable: boolean;
  stepId?: StepId;
};

export type GenerationRun = {
  id: RunId;
  kind: RunKind;
  productionId: ProductionId;
  pieceId?: PieceId;
  parentRunId?: RunId;
  retryOfRunId?: RunId;
  prompt: PromptRef;
  model: ModelInfo;
  /** Context of the run: source version, brief snapshot, parent version, segments used. */
  inputs: Ref[];
  output?: VersionRef;
  status: RunStatus;
  steps: RunStep[];
  usage?: Usage;
  cost?: Cost;
  error?: RunError;
  createdBy: ActorId;
  createdAt: IsoDateTime;
  startedAt?: IsoDateTime;
  endedAt?: IsoDateTime;
};

export function isRunActive(run: Pick<GenerationRun, 'status'>): boolean {
  return run.status === 'queued' || run.status === 'running' || run.status === 'awaiting_input';
}

export function isRunFinished(run: Pick<GenerationRun, 'status'>): boolean {
  return run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled';
}

export function runDurationMs(run: Pick<GenerationRun, 'startedAt' | 'endedAt'>, now?: IsoDateTime): number | undefined {
  if (!run.startedAt) return undefined;
  const end = run.endedAt ?? now;
  if (!end) return undefined;
  const duration = Date.parse(end) - Date.parse(run.startedAt);
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}

export function currentStep(run: Pick<GenerationRun, 'steps'>): RunStep | undefined {
  return run.steps.find((step) => step.state === 'current' || step.state === 'awaiting_input' || step.state === 'error');
}

export function stepProgress(run: Pick<GenerationRun, 'steps'>): { done: number; total: number } {
  const counted = run.steps.filter((step) => step.state !== 'skipped');
  return { done: counted.filter((step) => step.state === 'done').length, total: counted.length };
}
