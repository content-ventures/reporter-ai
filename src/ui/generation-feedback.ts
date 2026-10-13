import type { GenerationRun } from '../domain/run.ts';
import { formatDuration } from './format.ts';

export type FeedbackRun = Pick<GenerationRun, 'status' | 'steps'> & Partial<Pick<GenerationRun, 'createdAt' | 'startedAt' | 'endedAt' | 'model' | 'error'>>;

/** A tab follows a newer run, but an optimistic ID stays selected before it reaches queries. */
export function newestRunId(runs: readonly Pick<GenerationRun, 'id' | 'createdAt'>[], started?: string): string | undefined {
  const newest = [...runs].sort((a,b) => b.createdAt.localeCompare(a.createdAt))[0];
  const own = runs.find(run => run.id === started);
  return started && !own ? started : newest?.id;
}

/** Progress is recorded work, not an invented percentage or ETA. */
export function generationFeedback(run: FeedbackRun, now?: number) {
  const current = run.steps.filter(step => step.state === 'current').at(-1);
  const start = Date.parse(run.startedAt ?? run.createdAt ?? '');
  const end = run.endedAt ? Date.parse(run.endedAt) : now;
  const elapsedMs = end === undefined || !Number.isFinite(start) ? undefined : Math.max(0, end-start);
  const elapsed = elapsedMs === undefined ? undefined : `${formatDuration(elapsedMs)} decorridos`;
  const label = run.status === 'queued' || run.steps.every(step => step.state === 'upcoming') ? 'Na fila para iniciar' : current?.label ?? 'Validando o resultado';
  const retrying = current?.meta && /nova tentativa|limite temporário/i.test(current.meta);
  const detail = retrying ? current.meta : current?.meta && !current.meta.startsWith('Aguardando ') ? current.meta : undefined;
  const notice = retrying ? current.meta : `${label}. Você pode acompanhar a prévia; a edição será liberada após a validação.`;
  return { elapsed, label, detail, notice, background: 'Você pode sair desta página; a geração continua no servidor.' };
}
