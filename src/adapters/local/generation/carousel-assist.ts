import { paragraphBlock } from '../../../domain/article.ts';
import type { ArticleBody } from '../../../domain/article.ts';
import type { CarouselBody, CarouselTemplate, SlideAssistAction } from '../../../domain/carousel.ts';
import type { SlideId } from '../../../domain/ids.ts';
import { ok, refuse } from '../../../domain/result.ts';
import type { Result } from '../../../domain/result.ts';
import { SLIDE_ASSIST_LABELS } from '../../../ports/generation.ts';
import type { StartRefusal } from '../../../ports/generation.ts';
import type { AssistPlan, PlannedSuggestion } from './assist-plan.ts';
import { fitSlide, rewriteSlide, swapPoint, updateProposals } from './slide-assist.ts';
import type { SlideProposal } from './slide-assist.ts';

/**
 * Plan of a "carousel.assist" run: the slide proposals computed before streaming (like the
 * article's inline actions), each streamed as a short preview and stored as a `Suggestion` with
 * proposal kind `slide`. "Encurtar para caber" asks the renderer (approximate, by lines) through
 * `measure`; the other actions read the article version behind the carousel.
 */

/** Overflow of each slot as the renderer measures it (`RenderService.measure`). */
export type SlotMeasure = (body: CarouselBody) => readonly { slideId: string; slotId: string; overflow: boolean }[];

export type CarouselAssistContext = {
  body: CarouselBody;
  template: CarouselTemplate | undefined;
  /** Article version the carousel was written from. */
  article: ArticleBody | undefined;
  /** Newest approved article version ("Atualizar slides"). */
  approved: ArticleBody | undefined;
  measure: SlotMeasure | undefined;
  newId: (prefix: string) => string;
};

function planned(proposal: SlideProposal, newId: (prefix: string) => string): PlannedSuggestion {
  const id = newId('sug');
  const label = SLIDE_ASSIST_LABELS[proposal.kind];
  const preview = Object.values(proposal.slots).join(' · ') || label;
  return {
    preview: paragraphBlock(id, preview, { ai: 'unreviewed' }),
    target: [],
    proposal: {
      kind: 'slide',
      slideId: proposal.slideId,
      slots: proposal.slots,
      action: proposal.kind,
      ...(proposal.sourceBlockIds ? { sourceBlockIds: proposal.sourceBlockIds } : {}),
    },
    label,
  };
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function planCarouselAssist(action: SlideAssistAction, slideIds: readonly SlideId[], context: CarouselAssistContext): Result<AssistPlan, StartRefusal> {
  const { body, template, article, measure, newId } = context;
  if (action === 'update') {
    if (!article || !context.approved) return refuse('parent_not_ready', 'A versão aprovada do artigo não foi encontrada.');
    const proposals = updateProposals(body, template, article, context.approved);
    if (proposals.length === 0) return refuse('no_change', 'Os slides já seguem a versão aprovada.');
    return ok({ reply: [], suggestions: proposals.map((proposal) => planned(proposal, newId)), sourcesUsed: [], meta: plural(proposals.length, 'slide', 'slides') });
  }
  const slideId = slideIds[0];
  const slide = body.slides.find((candidate) => candidate.id === slideId);
  if (!slide) return refuse('invalid_target', 'O slide não existe mais.');
  const assist = { slide, template, article, slides: body.slides };
  let result;
  if (action === 'fit') {
    const fits = measure?.(body) ?? [];
    const overflowing = new Set(fits.filter((fit) => fit.slideId === slide.id && fit.overflow).map((fit) => fit.slotId));
    const fitsSlot = (slotId: string, text: string) => {
      if (!measure) return true;
      const probe: CarouselBody = { ...body, slides: [{ ...slide, slots: { ...slide.slots, [slotId]: text } }] };
      return !measure(probe).some((fit) => fit.slotId === slotId && fit.overflow);
    };
    result = fitSlide(assist, overflowing, fitsSlot);
  } else {
    result = action === 'swap' ? swapPoint(assist) : rewriteSlide(assist);
  }
  if (!result.ok) return refuse('no_change', result.reason);
  return ok({ reply: [], suggestions: [planned(result.proposal, newId)], sourcesUsed: [], meta: SLIDE_ASSIST_LABELS[action] });
}
