import type { ModelInfo, Usage } from './run.ts';
import { pipelineModelLabel } from './pipeline.ts';
import type { WritingTrace, WritingOrchestration } from './writing-orchestration.ts';
import { WRITING_STAGES } from './writing-orchestration.ts';

/** A claim's identity never depends on the retry budget, which rate limits may decrement. */
export function nextWritingExecutionAttempt(traces: readonly WritingTrace[]): number {
  return traces.reduce((highest, trace) => {
    const attempt = trace.executionAttempt ?? Number(/^(\d+)-/.exec(trace.id)?.[1] ?? 0);
    return Number.isSafeInteger(attempt) && attempt > highest ? attempt : highest;
  }, 0) + 1;
}

export function writingTraceForExecution(trace: WritingTrace, executionAttempt: number): WritingTrace {
  return { ...trace, id: `${executionAttempt}-${trace.id}`, executionAttempt };
}

/** A new lease cannot leave an abandoned stage looking like a live provider request. */
export function interruptWritingTraces(traces: readonly WritingTrace[], completedAt: string,
  error = 'WORKER_INTERRUPTED', reason = 'O processamento anterior foi interrompido antes de concluir esta etapa.'): WritingTrace[] {
  return traces.map(trace => trace.status === 'running' ? { ...trace, status: 'failed', completedAt, error, reason } : trace);
}

/** Report the sum of known consumption, including invalid paid outputs. A missing count is
 * unknown, never zero. Omit the total while any terminal request remains unmetered. */
export function writingTraceUsage(traces: readonly WritingTrace[]): Usage | undefined {
  const terminal = traces.filter(trace => trace.stage !== 'research' && trace.status !== 'running');
  const count = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const input = terminal.flatMap(trace => trace.cached ? [0] : count(trace.inputTokens) ? [trace.inputTokens] : []);
  const output = terminal.flatMap(trace => trace.cached ? [0] : count(trace.outputTokens) ? [trace.outputTokens] : []);
  if (!input.length && !output.length) return undefined;
  const inputTokens = input.reduce((sum, tokens) => sum + tokens, 0), outputTokens = output.reduce((sum, tokens) => sum + tokens, 0);
  return { ...(input.length ? { inputTokens } : {}), ...(output.length ? { outputTokens } : {}),
    ...(input.length === terminal.length && output.length === terminal.length ? { totalTokens: inputTokens + outputTokens } : {}) };
}

/** Platform usage has one model per run; never price a mixed run at the writer's tariff. */
export function writingRunModel(configuration: WritingOrchestration, revision: number): ModelInfo {
  const models = WRITING_STAGES.filter(stage => stage !== 'correct' || configuration.maxCorrections > 0).map(stage => configuration.stages[stage].model);
  if (new Set(models).size > 1) return { alias: 'writing/multi-model', label: 'Orquestração editorial · vários modelos', engine: 'provider' };
  const model = configuration.stages.write.model;
  return { alias: model, label: pipelineModelLabel(model) + ' · pipeline v' + revision, engine: 'provider' };
}
