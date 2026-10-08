import { foldRun, SIMULATED_MODEL, stampRunEvent } from '../../domain/index.ts';
import type {
  ActorId,
  GenerationRun,
  IsoDateTime,
  PieceId,
  ProductionId,
  Ref,
  RunError,
  RunEvent,
  RunEventPayload,
  RunId,
  RunKind,
  Source,
  StepId,
  VersionRef,
} from '../../domain/index.ts';
import { recipeFor } from '../../registries/index.ts';
import type { ArticleDraftScript } from '../script-book.ts';
import { after } from '../time.ts';

/** Run records for fixtures: finished runs as plain records, live/failed runs as event logs. */

export type RunPlan = {
  id: RunId;
  kind: RunKind;
  productionId: ProductionId;
  pieceId: PieceId;
  createdBy: ActorId;
  inputs: Ref[];
  startedAt: IsoDateTime;
  durationMs: number;
  sections?: number;
  output?: VersionRef;
  /** Live detail per step ("98 falas · 3 falantes"). */
  meta?: Record<StepId, string>;
};

/** A completed simulated run: every recipe step done, evenly spread over the duration, no cost. */
export function completedRun(plan: RunPlan): GenerationRun {
  const recipe = recipeFor(plan.kind);
  const steps = recipe.steps({ sections: plan.sections });
  const slice = plan.durationMs / steps.length;
  const at = (ms: number) => after(plan.startedAt, { seconds: ms / 1000 });
  const run: GenerationRun = {
    id: plan.id,
    kind: plan.kind,
    productionId: plan.productionId,
    pieceId: plan.pieceId,
    prompt: recipe.prompt,
    model: SIMULATED_MODEL,
    inputs: plan.inputs,
    status: 'completed',
    steps: steps.map((step, index) => {
      const entry = { ...step, state: 'done' as const, startedAt: at(index * slice), endedAt: at((index + 1) * slice) };
      const meta = plan.meta?.[step.id];
      return meta ? { ...entry, meta } : entry;
    }),
    createdBy: plan.createdBy,
    createdAt: plan.startedAt,
    startedAt: plan.startedAt,
    endedAt: at(plan.durationMs),
  };
  if (plan.output) run.output = plan.output;
  return run;
}

export type ArticleStreamPlan = {
  id: RunId;
  productionId: ProductionId;
  pieceId: PieceId;
  createdBy: ActorId;
  inputs: Ref[];
  startedAt: IsoDateTime;
  source: Source;
  script: ArticleDraftScript;
  /** Stop the log at this step: still `running` there, or `failed` with the error. */
  stopAt: StepId;
  outcome: 'running' | 'failed';
  error?: Omit<RunError, 'stepId'>;
  retryOfRunId?: RunId;
};

/** Pause between events of the simulated stream (ms), also used to place the log before "now". */
export const STREAM_TICK_MS = 700;

/**
 * Event log of an article run up to `stopAt`. Completed sections are emitted as
 * `block.started` + `block.completed` (the attach snapshot never replays deltas).
 */
export function articleRunEvents(plan: ArticleStreamPlan): RunEvent[] {
  const steps = recipeFor('article.generate').steps({ sections: plan.script.sections.length - 1 });
  if (!steps.some((step) => step.id === plan.stopAt)) throw new Error(`Unknown step ${plan.stopAt}`);
  const payloads: RunEventPayload[] = [];
  payloads.push({
    type: 'run.started',
    kind: 'article.generate',
    productionId: plan.productionId,
    pieceId: plan.pieceId,
    prompt: recipeFor('article.generate').prompt,
    model: SIMULATED_MODEL,
    inputs: plan.inputs,
    steps,
    createdBy: plan.createdBy,
    ...(plan.retryOfRunId ? { retryOfRunId: plan.retryOfRunId } : {}),
  });

  const segments = plan.source.versions[plan.source.versions.length - 1].content.segments;
  const readMeta = `${segments.length} falas · ${plan.source.speakers.length} falantes`;
  for (const step of steps) {
    if (step.id === plan.stopAt) {
      payloads.push({ type: 'step.started', stepId: step.id });
      if (plan.outcome === 'failed') {
        const error: RunError = { ...(plan.error ?? { code: 'simulated_failure', message: 'A geração falhou.', retryable: true }), stepId: step.id };
        payloads.push({ type: 'step.failed', stepId: step.id, error });
        payloads.push({ type: 'run.failed', error });
      }
      break;
    }
    if (step.id === 'read') {
      payloads.push({ type: 'step.started', stepId: step.id }, { type: 'step.completed', stepId: step.id, meta: readMeta });
    } else if (step.id === 'select') {
      payloads.push({ type: 'step.started', stepId: step.id });
      for (const ref of plan.script.keySegments) payloads.push({ type: 'source.used', ref });
      payloads.push({ type: 'step.completed', stepId: step.id, meta: `${plan.script.keySegments.length} falas-chave` });
    } else if (step.id === 'outline') {
      payloads.push(
        { type: 'step.started', stepId: step.id },
        { type: 'outline', title: plan.script.title, sections: plan.script.outline },
        { type: 'step.completed', stepId: step.id, meta: `${plan.script.outline.length} intertítulos` },
      );
    } else {
      const section = plan.script.sections.find((entry) => entry.id === step.id);
      payloads.push({ type: 'step.started', stepId: step.id });
      for (const block of section?.blocks ?? []) {
        const shape = { id: block.id, type: block.type, ...(block.type === 'heading' ? { level: block.level } : {}) };
        payloads.push({ type: 'block.started', block: shape }, { type: 'block.completed', block: structuredClone(block) });
      }
      payloads.push({ type: 'step.completed', stepId: step.id });
    }
  }
  return payloads.map((payload, index) =>
    stampRunEvent(payload, plan.id, index + 1, after(plan.startedAt, { seconds: (index * STREAM_TICK_MS) / 1000 })),
  );
}

/** How long a stream plan's log lasts, to start it that long before "now". */
export function streamDurationMs(events: readonly RunEvent[]): number {
  return Math.max(0, events.length - 1) * STREAM_TICK_MS;
}

/** The run record is always the fold of its log, so record and snapshot never disagree. */
export function runFromEvents(events: readonly RunEvent[]): GenerationRun {
  const fold = foldRun(events);
  if (!fold) throw new Error('Run log without run.started');
  return fold.run;
}
