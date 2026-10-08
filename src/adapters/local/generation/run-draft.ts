import { articleCharacters, blockText } from '../../../domain/article.ts';
import type { ArticleBlock, HeadingBlock } from '../../../domain/article.ts';
import type { Ref } from '../../../domain/refs.ts';
import { dedupeRefs } from '../../../domain/refs.ts';
import { articleBodyFromRun } from '../../../domain/run-events.ts';
import { checkQuotes } from '../../../domain/quotes.ts';
import { formatCharacters, formatLaudas } from '../../../domain/sizing.ts';
import type { ArticleSize } from '../../../domain/sizing.ts';
import type { Source } from '../../../domain/source.ts';
import { OUTLINE_REVIEW } from '../../../ports/generation.ts';
import type { OutlineReviewInput } from '../../../ports/generation.ts';
import { draftSectionBlocks, materialMeta } from './draft-plan.ts';
import type { DraftPlan } from './draft-plan.ts';
import type { RunApi, RunChannel } from './engine.ts';
import { outlineMeta } from './outline.ts';
import type { OutlinePayload } from './outline.ts';
import type { ConcreteStep } from './recipes.ts';
import { DRAFT_STEPS, SIMULATED_FAILURE } from './recipes.ts';

/**
 * Executes the "aqui pedrão" recipe over a precomputed plan, in the editorial order (DECISION
 * §Generation): material → structure (sections, budgets, size, shortfall; optionally paused for
 * review) → sources and quotes → introduction and one child run per section → quote and size
 * check. A structure a person already reviewed is announced at once ("Estrutura revisada").
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
  /** What "Montando estrutura" announces (`outlineEvent`). */
  outline: OutlinePayload;
  size: ArticleSize;
};

/** Meta of the structure step when the draft follows a structure a person reviewed. */
export const REVIEWED_OUTLINE_META = 'Estrutura revisada';

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
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

export async function simpleStep(api: RunApi, stepId: string, body: () => Promise<string | undefined | false>): Promise<boolean> {
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
  // A simulated failure stops inside the second block with text (image slots arrive whole).
  const textual = blocks.flatMap((block, index) => (blockText(block) ? [index] : []));
  const failIndex = api.failsAt(step.id) ? (textual[1] ?? textual[0] ?? -1) : -1;
  for (const [index, block] of blocks.entries()) {
    if (index > 0 && !(await api.wait(api.pacing.beat()))) {
      api.cancel(child);
      return false;
    }
    const outcome = await api.stream(block, child, index === failIndex ? { stopAfter: 0.4 } : {});
    if (outcome === 'aborted') {
      api.cancel(child);
      return false;
    }
    if (outcome === 'failed') {
      api.fail(step.id, SIMULATED_FAILURE, child);
      return false;
    }
  }
  // Characters, never words: the size is a lauda count ("640 caracteres").
  const meta = formatCharacters(articleCharacters({ type: 'article', title: '', blocks }));
  api.finishChild(child, meta);
  api.completeStep(step.id, meta);
  return true;
}

/** "Montando estrutura": announces the structure (and pauses for its review in the simulation scenario). */
export async function outlineStep(api: RunApi, input: Pick<DraftRunInput, 'outline' | 'size' | 'reviewOutline'>): Promise<boolean> {
  const { outline } = input;
  const reviewed = outline.edited !== undefined;
  return simpleStep(api, DRAFT_STEPS.outline, async () => {
    // A structure the person already reviewed needs no thinking time.
    if (!reviewed && !(await api.wait(api.pacing.step()))) return false;
    api.emit(outline);
    if (input.reviewOutline && !reviewed) {
      const review = await api.awaitInput(
        DRAFT_STEPS.outline,
        { kind: OUTLINE_REVIEW, message: 'Revise a estrutura antes de escrever as seções.', payload: { title: outline.title, sections: outline.sections } },
        (value) => isOutlineReview(value, outline.sections.length),
      );
      if (review === undefined) return false;
      const edited = review as OutlineReviewInput;
      api.startStep(DRAFT_STEPS.outline, REVIEWED_OUTLINE_META);
      api.emit({
        ...outline,
        title: edited.title?.trim() || outline.title,
        sections: outline.sections.map((section, index) => ({ ...section, title: edited.sections[index].title.trim() })),
      });
      return REVIEWED_OUTLINE_META;
    }
    return reviewed ? REVIEWED_OUTLINE_META : outlineMeta(outline, input.size);
  });
}

export async function runDraft(input: DraftRunInput): Promise<void> {
  const { api, plan, steps } = input;
  const ok = await simpleStep(api, DRAFT_STEPS.read, async () => ((await api.wait(api.pacing.step())) ? materialMeta(plan) : false));
  if (!ok) return;

  // The structure first (sections, budgets, size), then the sources and quotes of each section.
  if (!(await outlineStep(api, input))) return;

  const quotesOk = await simpleStep(api, DRAFT_STEPS.select, async () => {
    if (!(await api.wait(api.pacing.step() / 2))) return false;
    for (const ref of plan.keyQuotes) {
      if (!(await api.wait(api.pacing.beat()))) return false;
      api.emit({ type: 'source.used', ref });
    }
    return plural(plan.keyQuotes.length, 'fala-chave', 'falas-chave');
  });
  if (!quotesOk) return;

  for (const step of steps) {
    if (step.id === DRAFT_STEPS.intro) {
      if (!(await writeStep(api, step, plan.intro, input.inputs))) return;
    } else if (step.id.startsWith('section-')) {
      const section = plan.sections.find((entry) => entry.stepId === step.id);
      if (!section) continue;
      const blocks = draftSectionBlocks(section.heading ? { ...section, heading: headingFor(api, section.heading) } : section);
      if (!(await writeStep(api, step, blocks, input.inputs))) return;
    }
  }

  const checkOk = await simpleStep(api, DRAFT_STEPS.check, async () => {
    if (!(await api.wait(api.pacing.step()))) return false;
    const body = articleBodyFromRun(api.channel.fold);
    const size = formatLaudas(articleCharacters(body));
    const checks = checkQuotes(body, input.sources);
    if (checks.length === 0) return `Nenhuma citação no texto · ${size}`;
    const verified = checks.filter((check) => check.status === 'verified').length;
    return `${verified} de ${checks.length} conferidas · ${size}`;
  });
  if (!checkOk) return;
  api.complete();
}
