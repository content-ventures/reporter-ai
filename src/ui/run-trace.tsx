'use client';

import type { ReactNode } from 'react';
import {
  AgentTrace,
  type AgentTraceStatus,
  type AgentTraceStep,
  type AgentTraceStepState,
} from '@content-ventures/design-system/v3';
import { RUN_KIND_LABELS, type GenerationRun, type RunStatus, type RunStep, type StepState } from '@/domain';
import { RECIPES } from '@/registries';
import { formatDuration, plural } from './format';

/**
 * A generation run (RunView, RunFold.run or RunState.fold.run) drawn as the DS AgentTrace:
 * visible steps, one spinner at a time, red only on failure, "Tentar de novo a partir desta
 * etapa" on the failed step. Everything comes from the run itself, so the studio, the overview
 * and the review history show the same trace. Writers read the steps and what each one did
 * ("640 caracteres"); timings and the model label ("Simulação local") are for admins
 * (`detail="admin"`, D11).
 */

const STEP_STATES: Record<StepState, AgentTraceStepState> = {
  upcoming: 'upcoming',
  current: 'current',
  done: 'done',
  error: 'error',
  skipped: 'skipped',
  // Paused for the person (outline review): still the step in focus.
  awaiting_input: 'current',
};

const RUN_STATUS: Partial<Record<RunStatus, AgentTraceStatus>> = {
  awaiting_input: 'running',
  completed: 'done',
  failed: 'error',
  cancelled: 'stopped',
};

export type TraceableRun = Pick<GenerationRun, 'kind' | 'status' | 'steps' | 'startedAt' | 'endedAt' | 'error'> &
  Partial<Pick<GenerationRun, 'model'>> & {
    durationMs?: number;
  };

/** `writer`: steps and what they did · `admin`: plus timings and the model. */
export type TraceDetail = 'writer' | 'admin';

/** Total duration of a run: the view's `durationMs`, else started → ended. */
export function runDuration(run: TraceableRun): number | undefined {
  if (run.durationMs !== undefined) return run.durationMs;
  if (!run.startedAt || !run.endedAt) return undefined;
  return Date.parse(run.endedAt) - Date.parse(run.startedAt);
}

function stepDuration(step: RunStep): string | undefined {
  if (!step.startedAt || !step.endedAt) return undefined;
  const ms = Date.parse(step.endedAt) - Date.parse(step.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? formatDuration(ms) : undefined;
}

/**
 * Writers: "Concluída · 6 etapas · Próximo: revisar o texto e enviar para aprovação" (the recipe's
 * `next`, when it has one), "Interrompida". Admins: "Simulação local · Concluída em 38 s ·
 * 6 etapas", "Simulação local · Interrompida em 12 s".
 */
export function runSummary(run: TraceableRun, detail: TraceDetail = 'writer'): string | undefined {
  const admin = detail === 'admin';
  const duration = admin ? runDuration(run) : undefined;
  const done = run.steps.filter((step) => step.state === 'done').length;
  const model = admin ? run.model?.label : undefined;
  if (run.status === 'completed') {
    // The recipe's closing line says what the person does next ("Próximo: revisar o texto e enviar
    // para aprovação", DECISION §Generation 7): human review and approval stay mandatory.
    const next = RECIPES.find((recipe) => recipe.kind === run.kind)?.next;
    return [model, duration !== undefined ? `Concluída em ${formatDuration(duration)}` : 'Concluída', plural(done, 'etapa', 'etapas'), next]
      .filter(Boolean)
      .join(' · ');
  }
  if (run.status === 'cancelled') {
    return [model, duration !== undefined ? `Interrompida em ${formatDuration(duration)}` : 'Interrompida'].filter(Boolean).join(' · ');
  }
  return undefined;
}

/** Run steps → AgentTrace steps (meta: live detail or the step duration; error: the reason). */
export function traceSteps(
  run: TraceableRun,
  extra?: { detail?: (step: RunStep) => ReactNode; sources?: (step: RunStep) => ReactNode; timings?: boolean },
): AgentTraceStep[] {
  // An interrupted run never reached its remaining steps: they read as not done, not "skipped"
  // (the DS AgentTrace has no "interrompida" step state yet); the first one says where it stopped.
  const stoppedAt = run.status === 'cancelled' ? run.steps.find((step) => step.state === 'skipped')?.id : undefined;
  return run.steps.map((step) => {
    const interrupted = run.status === 'cancelled' && step.state === 'skipped';
    const item: AgentTraceStep = { id: step.id, label: step.label, state: interrupted ? 'upcoming' : STEP_STATES[step.state] };
    if (step.id === stoppedAt) item.meta = 'Interrompida aqui';
    const meta = step.meta ?? (step.state === 'done' && extra?.timings ? stepDuration(step) : undefined);
    if (meta && !interrupted) item.meta = meta;
    const failure = step.state === 'error' && run.error && (!run.error.stepId || run.error.stepId === step.id) ? run.error.message : undefined;
    const detail = failure ?? (step.state === 'awaiting_input' ? 'Aguardando você' : extra?.detail?.(step));
    if (detail) item.detail = detail;
    const sources = extra?.sources?.(step);
    if (sources) item.sources = sources;
    return item;
  });
}

export type RunTraceProps = {
  run: TraceableRun;
  /** Run name ("Geração do artigo"); default from the run kind. */
  label?: string;
  /** `full` header + steps · `compact` one line (current step + "3/6") for lists and panels. */
  variant?: 'full' | 'compact';
  /** End summary; default "Concluída em 38 s · 6 etapas" / "Interrompida em 12 s". */
  summary?: ReactNode;
  /** Extra line under a step (not used for failures, which show the run error). */
  stepDetail?: (step: RunStep) => ReactNode;
  /** Sources a step used (e.g. SourceChipFor for "Selecionando falas-chave"). */
  stepSources?: (step: RunStep) => ReactNode;
  /** "Tentar de novo a partir desta etapa" on the failed step. */
  onRetry?: (stepId: string) => void;
  retryLabel?: string;
  /** Announce step changes (turn off in lists with several runs). */
  announce?: boolean;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** `compact`: the newest words being written, on a second line cut with an ellipsis. */
  preview?: ReactNode;
  /** `compact`: action at the end of the line ("Abrir"). */
  action?: ReactNode;
  /** `writer` (default): no timings, no model · `admin`: step durations and the model in the summary. */
  detail?: TraceDetail;
};

export function RunTrace({
  run,
  label,
  variant = 'full',
  summary,
  stepDetail,
  stepSources,
  onRetry,
  retryLabel,
  announce,
  collapsible,
  defaultCollapsed,
  collapsed,
  onCollapsedChange,
  preview,
  action,
  detail = 'writer',
}: RunTraceProps) {
  return (
    <AgentTrace
      label={label ?? RUN_KIND_LABELS[run.kind]}
      steps={traceSteps(run, { detail: stepDetail, sources: stepSources, timings: detail === 'admin' })}
      status={RUN_STATUS[run.status]}
      summary={summary ?? runSummary(run, detail)}
      variant={variant}
      onRetry={onRetry}
      retryLabel={retryLabel}
      announce={announce}
      collapsible={collapsible}
      defaultCollapsed={defaultCollapsed}
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
      preview={preview}
      action={action}
    />
  );
}
