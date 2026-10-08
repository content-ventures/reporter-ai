'use client';

import type { ReactNode } from 'react';
import {
  AgentTrace,
  type AgentTraceStatus,
  type AgentTraceStep,
  type AgentTraceStepState,
} from '@content-ventures/design-system/v3';
import { RUN_KIND_LABELS, type GenerationRun, type RunStatus, type RunStep, type StepState } from '@/domain';
import { formatDuration, plural } from './format';

/**
 * A generation run (RunView, RunFold.run or RunState.fold.run) drawn as the DS AgentTrace:
 * visible steps, one spinner at a time, red only on failure, "Tentar de novo a partir desta
 * etapa" on the failed step. Everything comes from the run itself, so the studio, the overview
 * "Gerando agora" panel and the review history show the same trace.
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

export type TraceableRun = Pick<GenerationRun, 'kind' | 'status' | 'steps' | 'startedAt' | 'endedAt' | 'error'> & {
  durationMs?: number;
};

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

/** "Concluída em 38 s · 6 etapas", "Interrompida em 12 s". */
export function runSummary(run: TraceableRun): string | undefined {
  const duration = runDuration(run);
  const done = run.steps.filter((step) => step.state === 'done').length;
  if (run.status === 'completed') {
    return [duration !== undefined ? `Concluída em ${formatDuration(duration)}` : 'Concluída', plural(done, 'etapa', 'etapas')].join(' · ');
  }
  if (run.status === 'cancelled') {
    return duration !== undefined ? `Interrompida em ${formatDuration(duration)}` : 'Interrompida';
  }
  return undefined;
}

/** Run steps → AgentTrace steps (meta: live detail or the step duration; error: the reason). */
export function traceSteps(
  run: TraceableRun,
  extra?: { detail?: (step: RunStep) => ReactNode; sources?: (step: RunStep) => ReactNode },
): AgentTraceStep[] {
  // An interrupted run never reached its remaining steps: they read as not done, not "skipped"
  // (the DS AgentTrace has no "interrompida" step state yet); the first one says where it stopped.
  const stoppedAt = run.status === 'cancelled' ? run.steps.find((step) => step.state === 'skipped')?.id : undefined;
  return run.steps.map((step) => {
    const interrupted = run.status === 'cancelled' && step.state === 'skipped';
    const item: AgentTraceStep = { id: step.id, label: step.label, state: interrupted ? 'upcoming' : STEP_STATES[step.state] };
    if (step.id === stoppedAt) item.meta = 'Interrompida aqui';
    const meta = step.meta ?? (step.state === 'done' ? stepDuration(step) : undefined);
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
}: RunTraceProps) {
  return (
    <AgentTrace
      label={label ?? RUN_KIND_LABELS[run.kind]}
      steps={traceSteps(run, { detail: stepDetail, sources: stepSources })}
      status={RUN_STATUS[run.status]}
      summary={summary ?? runSummary(run)}
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
