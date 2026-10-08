import { articleCharacters } from '../../../domain/article.ts';
import type { ArticleBody } from '../../../domain/article.ts';
import { slotIssues } from '../../../domain/carousel.ts';
import type { CarouselBody, CarouselTemplate, Slide } from '../../../domain/carousel.ts';
import type { VersionRef } from '../../../domain/refs.ts';
import { formatLaudas } from '../../../domain/sizing.ts';
import type { SlotMeasure } from './carousel-assist.ts';
import type { CarouselPlan } from './carousel-plan.ts';
import type { RunApi } from './engine.ts';
import { SIMULATED_FAILURE } from './recipes.ts';
import { fitSlide } from './slide-assist.ts';

/**
 * Executes "carousel.copy": reads the approved article version, picks the points, writes the
 * cover, then the other slides one by one (`slide.completed`), and checks the limits: the render
 * measures the lines of every slot, and a text over its lines (or its characters) is shortened
 * before the run ends — the shorter slide replaces the streamed one (`slide.completed` again).
 */

export type CarouselRunInput = {
  api: RunApi;
  plan: CarouselPlan;
  article: ArticleBody;
  parent: VersionRef;
  template: CarouselTemplate;
  /** Line fit as the renderer measures it (`RenderService.measure`); without it, characters only. */
  measure?: SlotMeasure;
};

export type FittedSlides = {
  slides: Slide[];
  /** Slides whose text was shortened. */
  changed: Slide[];
  /** Slot texts shortened to fit. */
  shortened: number;
  /** Slot texts still over their limit (no cut keeps the sense). */
  over: number;
};

function slotsOver(body: CarouselBody, template: CarouselTemplate, measure: SlotMeasure | undefined): Map<string, Set<string>> {
  const over = new Map<string, Set<string>>();
  const add = (slideId: string, slotId: string) => over.set(slideId, (over.get(slideId) ?? new Set()).add(slotId));
  for (const issue of slotIssues(body, template)) if (issue.kind === 'overflow') add(issue.slideId, issue.slotId);
  for (const fit of measure?.(body) ?? []) if (fit.overflow) add(fit.slideId, fit.slotId);
  return over;
}

/**
 * "Conferindo limites": every slot over its rendered lines or its characters gets the longest
 * shorter version (whole sentences, then clauses, then a word cut) that the renderer says fits.
 */
export function fitSlidesToRender(body: CarouselBody, template: CarouselTemplate, measure: SlotMeasure | undefined): FittedSlides {
  const over = slotsOver(body, template, measure);
  const changed: Slide[] = [];
  let shortened = 0;
  const slides = body.slides.map((slide) => {
    const overflowing = over.get(slide.id);
    if (!overflowing) return slide;
    const fits = (slotId: string, text: string) => {
      if (!measure) return true;
      const probe: CarouselBody = { ...body, slides: [{ ...slide, slots: { ...slide.slots, [slotId]: text } }] };
      return !measure(probe).some((fit) => fit.slotId === slotId && fit.overflow);
    };
    const fitted = fitSlide({ slide, template }, overflowing, fits);
    if (!fitted.ok) return slide;
    shortened += Object.keys(fitted.proposal.slots).length;
    const next: Slide = { ...slide, slots: { ...slide.slots, ...fitted.proposal.slots } };
    changed.push(next);
    return next;
  });
  const left = slotsOver({ ...body, slides }, template, measure);
  return { slides, changed, shortened, over: [...left.values()].reduce((sum, slots) => sum + slots.size, 0) };
}

const texts = (count: number) => (count === 1 ? '1 texto' : `${count} textos`);

/** Trace meta of the limits step: "Todos os textos cabem", "2 textos encurtados para caber". */
export function limitsMeta(fitted: Pick<FittedSlides, 'shortened' | 'over'>): string {
  const parts = [
    fitted.shortened > 0 ? `${texts(fitted.shortened)} ${fitted.shortened === 1 ? 'encurtado' : 'encurtados'} para caber` : null,
    fitted.over > 0 ? `${texts(fitted.over)} acima do limite` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : 'Todos os textos cabem';
}

async function step(api: RunApi, stepId: string, body: () => Promise<string | undefined | false>): Promise<boolean> {
  if (api.replay(stepId)) return true;
  api.startStep(stepId);
  if (api.failsAt(stepId)) {
    if (await api.wait(api.pacing.step() / 2)) api.fail(stepId, SIMULATED_FAILURE);
    else api.cancel();
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

export async function runCarousel(input: CarouselRunInput): Promise<void> {
  const { api, plan } = input;
  const [cover, ...rest] = plan.slides;
  const proceed =
    (await step(api, 'read', async () =>
      // The approved article in laudas (never a version number or words on a writer's screen).
      (await api.wait(api.pacing.step())) ? `Artigo aprovado · ${formatLaudas(articleCharacters(input.article))}` : false,
    )) &&
    (await step(api, 'points', async () => ((await api.wait(api.pacing.step())) ? `${plan.slides.length} slides` : false))) &&
    (await step(api, 'cover', async () => {
      if (!(await api.wait(api.pacing.firstToken()))) return false;
      if (cover) api.emit({ type: 'slide.completed', slide: cover });
      return 'Capa';
    })) &&
    (await step(api, 'slides', async () => {
      for (const [index, slide] of rest.entries()) {
        api.emit({ type: 'step.progress', stepId: 'slides', meta: `slide ${index + 2} de ${plan.slides.length}` });
        if (!(await api.wait(api.pacing.step() / 2))) return false;
        api.emit({ type: 'slide.completed', slide });
      }
      return `${plan.slides.length} slides`;
    })) &&
    (await step(api, 'limits', async () => {
      if (!(await api.wait(api.pacing.step() / 2))) return false;
      const body: CarouselBody = { type: 'carousel', templateId: input.template.id, slides: api.channel.fold.slides };
      const fitted = fitSlidesToRender(body, input.template, input.measure);
      for (const slide of fitted.changed) api.emit({ type: 'slide.completed', slide });
      return limitsMeta(fitted);
    }));
  if (proceed) api.complete();
}
