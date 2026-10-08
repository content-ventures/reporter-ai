import { blockText } from '../../../domain/article.ts';
import type { ArticleBlock, HeadingBlock } from '../../../domain/article.ts';
import type { Ref } from '../../../domain/refs.ts';
import { dedupeRefs } from '../../../domain/refs.ts';
import { articleBodyFromRun } from '../../../domain/run-events.ts';
import type { OutlineSection } from '../../../domain/run-events.ts';
import { checkQuotes } from '../../../domain/quotes.ts';
import type { Source } from '../../../domain/source.ts';
import { countWords } from '../../../domain/text/stats.ts';
import { OUTLINE_REVIEW } from '../../../ports/generation.ts';
import type { OutlineReviewInput } from '../../../ports/generation.ts';
import { materialMeta } from './draft-plan.ts';
import type { DraftPlan } from './draft-plan.ts';
import type { RunApi, RunChannel } from './engine.ts';
import type { ConcreteStep } from './recipes.ts';
import { DRAFT_STEPS, SIMULATED_FAILURE } from './recipes.ts';

/**
 * Executes the "aqui pedrão" recipe over a precomputed plan: material → key quotes → outline
 * (optionally paused for review) → introduction and one child run per section → quote check.
 * Steps reused from a previous attempt are replayed instantly.
 */

export type DraftRunInput = {
  api: RunApi;
  plan: DraftPlan;
  steps: readonly ConcreteStep[];
  sources: readonly Source[];
  /** Run context shared by child runs (source versions, brief). */
  inputs: Ref[];
  reviewOutline: boolean;
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function outlineOf(plan: DraftPlan): OutlineSection[] {
  return plan.sections.map((section) => ({ blockId: section.heading.id, title: blockText(section.heading) }));
}

export function isOutlineReview(input: unknown, sections: number): input is OutlineReviewInput {
  if (!input || typeof input !== 'object') return false;
  const value = input as Partial<OutlineReviewInput>;
  if (value.title !== undefined && typeof value.title !== 'string') return false;
  return (
    Array.isArray(value.sections) &&
    value.sections.length === sections &&
    value.sections.every((section) => typeof section?.title === 'string' && section.title.trim().length > 0)
  );
}

/** Heading as the (possibly reviewed) outline names it. */
function headingFor(api: RunApi, heading: HeadingBlock): HeadingBlock {
  const title = api.channel.fold.outline.find((section) => section.blockId === heading.id)?.title;
  return title && title !== blockText(heading) ? { ...heading, inlines: [{ text: title }] } : heading;
}

async function simpleStep(api: RunApi, stepId: string, body: () => Promise<string | undefined | false>): Promise<boolean> {
  if (api.replay(stepId)) return true;
  api.startStep(stepId);
  if (api.failsAt(stepId)) {
    if (!(await api.wait(api.pacing.step() / 2))) {
      api.cancel();
      return false;
    }
    api.fail(stepId, SIMULATED_FAILURE);
    return false;
  }
  const meta = await body();
  if (meta === false) {
    api.cancel();
    return false;
  }
  api.completeStep(stepId, meta);
  return true;
}

async function writeStep(api: RunApi, step: ConcreteStep, blocks: ArticleBlock[], inputs: Ref[]): Promise<boolean> {
  if (api.replay(step.id)) return true;
  api.startStep(step.id);
  const evidence = dedupeRefs(blocks.flatMap((block) => block.sourceRefs ?? []));
  const child: RunChannel = api.openChild(step.id, step.label, [...inputs, ...evidence]);
  if (!(await api.wait(api.pacing.firstToken()))) {
    api.cancel(child);
    return false;
  }
  const failing = api.failsAt(step.id);
  for (const [index, block] of blocks.entries()) {
    if (index > 0 && !(await api.wait(api.pacing.beat()))) {
      api.cancel(child);
      return false;
    }
    const outcome = await api.stream(block, child, failing && index === Math.min(1, blocks.length - 1) ? { stopAfter: 0.4 } : {});
    if (outcome === 'aborted') {
      api.cancel(child);
      return false;
    }
    if (outcome === 'failed') {
      api.fail(step.id, SIMULATED_FAILURE, child);
      return false;
    }
  }
  const words = blocks.reduce((sum, block) => sum + countWords(blockText(block)), 0);
  const meta = `${words} palavras`;
  api.finishChild(child, meta);
  api.completeStep(step.id, meta);
  return true;
}

export async function runDraft(input: DraftRunInput): Promise<void> {
  const { api, plan, steps } = input;
  const ok = await simpleStep(api, DRAFT_STEPS.read, async () => ((await api.wait(api.pacing.step())) ? materialMeta(plan) : false));
  if (!ok) return;

  const quotesOk = await simpleStep(api, DRAFT_STEPS.select, async () => {
    if (!(await api.wait(api.pacing.step() / 2))) return false;
    for (const ref of plan.keyQuotes) {
      if (!(await api.wait(api.pacing.beat()))) return false;
      api.emit({ type: 'source.used', ref });
    }
    return plural(plan.keyQuotes.length, 'fala-chave', 'falas-chave');
  });
  if (!quotesOk) return;

  const outlineOk = await simpleStep(api, DRAFT_STEPS.outline, async () => {
    if (!(await api.wait(api.pacing.step()))) return false;
    const sections = outlineOf(plan);
    api.emit({ type: 'outline', title: plan.title, sections });
    if (input.reviewOutline) {
      const review = await api.awaitInput(
        DRAFT_STEPS.outline,
        { kind: OUTLINE_REVIEW, message: 'Revise a estrutura antes de escrever as seções.', payload: { title: plan.title, sections } },
        (value) => isOutlineReview(value, sections.length),
      );
      if (review === undefined) return false;
      const edited = review as OutlineReviewInput;
      api.startStep(DRAFT_STEPS.outline, 'Estrutura revisada');
      api.emit({
        type: 'outline',
        title: edited.title?.trim() || plan.title,
        sections: sections.map((section, index) => ({ ...section, title: edited.sections[index].title.trim() })),
      });
    }
    return plural(sections.length, 'seção', 'seções');
  });
  if (!outlineOk) return;

  for (const step of steps) {
    if (step.id === DRAFT_STEPS.intro) {
      if (!(await writeStep(api, step, plan.intro, input.inputs))) return;
    } else if (step.id.startsWith('section-')) {
      const section = plan.sections.find((entry) => entry.stepId === step.id);
      if (!section) continue;
      if (!(await writeStep(api, step, [headingFor(api, section.heading), ...section.blocks], input.inputs))) return;
    }
  }

  const checkOk = await simpleStep(api, DRAFT_STEPS.check, async () => {
    if (!(await api.wait(api.pacing.step()))) return false;
    const checks = checkQuotes(articleBodyFromRun(api.channel.fold), input.sources);
    if (checks.length === 0) return 'Nenhuma citação no texto';
    const verified = checks.filter((check) => check.status === 'verified').length;
    return `${verified} de ${checks.length} conferidas`;
  });
  if (!checkOk) return;
  api.complete();
}
