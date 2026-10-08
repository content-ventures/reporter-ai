import type { StepId } from '../../../domain/ids.ts';
import type { RunEventPayload, RunFold } from '../../../domain/run-events.ts';
import { isRunActive } from '../../../domain/run.ts';
import type { GenerationRun } from '../../../domain/run.ts';
import type { CarouselPlan } from './carousel-plan.ts';
import type { DraftPlan } from './draft-plan.ts';
import { DRAFT_STEPS } from './recipes.ts';

/**
 * Reopening a run of an EARLIER session (a failed fixture run, a run a reload interrupted) so
 * "Tentar de novo a partir desta etapa" works exactly as it does live: the persisted stream
 * snapshot is the run's state, and the outputs of its finished steps are rebuilt from it (what a
 * live channel records step by step), so the retry replays them and writes only the rest.
 */

/**
 * The run as it ended. A reload settles an orphan in the record ("interrompida") but its stream
 * snapshot is still the last one written while streaming: the record's run wins for status and
 * steps, the snapshot keeps the text.
 */
export function settledFold(fold: RunFold, recorded: GenerationRun | undefined): RunFold | undefined {
  if (!isRunActive(fold.run)) return fold;
  if (!recorded || isRunActive(recorded)) return undefined;
  const settled: RunFold = { ...fold, run: { ...fold.run, ...recorded } };
  delete settled.awaiting;
  return settled;
}

function isDraftPlan(plan: DraftPlan | CarouselPlan): plan is DraftPlan {
  return 'sections' in plan;
}

/** Outputs of every finished step, keyed like `RunChannel.stepOutputs`. */
export function stepOutputsFromFold(plan: DraftPlan | CarouselPlan, fold: RunFold): Map<StepId, RunEventPayload[]> {
  const outputs = new Map<StepId, RunEventPayload[]>();
  const done = new Set(fold.run.steps.filter((step) => step.state === 'done').map((step) => step.id));
  const blocksOf = (ids: readonly string[]): RunEventPayload[] =>
    ids.flatMap((id) => {
      const block = fold.blocks.find((entry) => entry.id === id && entry.complete && entry.final);
      return block?.final ? [{ type: 'block.completed' as const, block: structuredClone(block.final) }] : [];
    });

  if (isDraftPlan(plan)) {
    for (const stepId of done) {
      if (stepId === DRAFT_STEPS.read) outputs.set(stepId, []);
      else if (stepId === DRAFT_STEPS.select) outputs.set(stepId, plan.keyQuotes.map((ref) => ({ type: 'source.used' as const, ref })));
      else if (stepId === DRAFT_STEPS.outline) {
        outputs.set(stepId, [{ type: 'outline', ...(fold.title !== undefined ? { title: fold.title } : {}), sections: structuredClone(fold.outline) }]);
      } else if (stepId === DRAFT_STEPS.intro) outputs.set(stepId, blocksOf(plan.intro.map((block) => block.id)));
      else {
        const section = plan.sections.find((entry) => entry.stepId === stepId);
        if (section) outputs.set(stepId, blocksOf([section.heading.id, ...section.blocks.map((block) => block.id)]));
      }
    }
    return outputs;
  }

  const [cover] = plan.slides;
  for (const stepId of done) {
    if (stepId === 'cover') {
      outputs.set(stepId, fold.slides.filter((slide) => slide.id === cover?.id).map((slide) => ({ type: 'slide.completed' as const, slide: structuredClone(slide) })));
    } else if (stepId === 'slides') {
      outputs.set(stepId, fold.slides.filter((slide) => slide.id !== cover?.id).map((slide) => ({ type: 'slide.completed' as const, slide: structuredClone(slide) })));
    } else outputs.set(stepId, []);
  }
  return outputs;
}

/**
 * Whether the plan computed now still describes the run (same steps, and every finished block
 * or slide of the snapshot is one the plan would write): otherwise a retry would mix two
 * different texts, and the person is offered "Gerar nova versão" instead.
 */
export function planMatchesFold(plan: DraftPlan | CarouselPlan, stepIds: readonly StepId[], fold: RunFold): boolean {
  const runSteps = fold.run.steps.map((step) => step.id);
  if (runSteps.length !== stepIds.length || runSteps.some((id, index) => id !== stepIds[index])) return false;
  if (isDraftPlan(plan)) {
    const ids = new Set([...plan.intro, ...plan.sections.flatMap((section) => [section.heading, ...section.blocks])].map((block) => block.id));
    return fold.blocks.every((block) => ids.has(block.id));
  }
  const ids = new Set(plan.slides.map((slide) => slide.id));
  return fold.slides.every((slide) => ids.has(slide.id));
}
