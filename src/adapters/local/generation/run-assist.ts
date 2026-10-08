import type { AssistPlan } from './assist-plan.ts';
import type { RunApi } from './engine.ts';
import type { ConcreteStep } from './recipes.ts';
import { SIMULATED_FAILURE } from './recipes.ts';

/**
 * Executes an inline action: a short reading step, optional evidence, then the proposal streamed
 * as a preview block (id = suggestion id) followed by the `suggestion` event. The document never
 * changes here; the person accepts or discards the suggestion later.
 */

export async function runAssist(api: RunApi, plan: AssistPlan, steps: readonly ConcreteStep[]): Promise<void> {
  for (const step of steps) {
    if (api.replay(step.id)) continue;
    api.startStep(step.id);
    const writing = step.id === 'write';
    if (api.failsAt(step.id) && !writing) {
      if (await api.wait(api.pacing.step() / 2)) api.fail(step.id, SIMULATED_FAILURE);
      else api.cancel();
      return;
    }
    if (!(await api.wait(writing ? api.pacing.firstToken() : api.pacing.step() / 2))) {
      api.cancel();
      return;
    }
    if (step.id === 'read') {
      for (const ref of plan.sourcesUsed) api.emit({ type: 'source.used', ref });
    }
    if (writing) {
      for (const block of plan.reply) {
        const outcome = await api.stream(block);
        if (outcome !== 'done') {
          api.cancel();
          return;
        }
      }
      for (const [index, suggestion] of plan.suggestions.entries()) {
        const failing = api.failsAt(step.id) && index === 0;
        const outcome = await api.stream(suggestion.preview, undefined, failing ? { stopAfter: 0.5 } : {});
        if (outcome === 'aborted') {
          api.cancel();
          return;
        }
        if (outcome === 'failed') {
          api.fail(step.id, SIMULATED_FAILURE);
          return;
        }
        api.emit({
          type: 'suggestion',
          suggestionId: suggestion.preview.id,
          target: suggestion.target,
          proposal: suggestion.proposal,
          label: suggestion.label,
        });
      }
      if (plan.suggestions.length === 0 && api.failsAt(step.id)) {
        api.fail(step.id, SIMULATED_FAILURE);
        return;
      }
    }
    api.completeStep(step.id, writing ? plan.meta : undefined);
  }
  api.complete();
}
