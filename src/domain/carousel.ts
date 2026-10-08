import type { AiReviewState } from './article.ts';
import type { BlockId, SlideId, TemplateId } from './ids.ts';
import { contentHash } from './text/hash.ts';

/**
 * Carousel body: template id + slides whose slots hold plain text. The visual creative is
 * content rendered from this data (RenderService), never a DS component.
 */

export type Slide = {
  id: SlideId;
  /** Layout id inside the template (cover, context, point, quote, closing…). */
  layout: string;
  /** Slot id → text. */
  slots: Record<string, string>;
  /** Article blocks this slide was written from (provenance back to the approved version). */
  sourceBlockIds: BlockId[];
  ai?: AiReviewState;
};

export type CarouselBody = { type: 'carousel'; templateId: TemplateId; slides: Slide[] };

export type SlotRole = 'kicker' | 'title' | 'body' | 'quote' | 'attribution' | 'cta';

export type SlotSpec = {
  id: string;
  label: string;
  role: SlotRole;
  /** Character budget used as a hint; the renderer reports real (approximate) overflow. */
  maxChars: number;
  maxLines?: number;
  required?: boolean;
};

export type SlideLayout = {
  id: string;
  label: string;
  slots: SlotSpec[];
  /** The layout draws the cover of the article it was made from (with its credit). */
  articleCover?: true;
};

export type CarouselTemplate = {
  id: TemplateId;
  name: string;
  width: number;
  height: number;
  minSlides: number;
  maxSlides: number;
  coverLayoutId: string;
  layouts: SlideLayout[];
};

/** Wireframe R1·3 default structure: Capa · Contexto · Ponto principal · Citação · Conclusão. */
export const DEFAULT_SLIDE_SEQUENCE: readonly string[] = ['cover', 'context', 'point', 'quote', 'closing'];

export function carouselHash(body: CarouselBody): string {
  return contentHash({
    templateId: body.templateId,
    slides: body.slides.map((slide) => ({
      layout: slide.layout,
      slots: Object.fromEntries(Object.entries(slide.slots).map(([key, value]) => [key, value.trim()])),
    })),
  });
}

/** Slide text in slot order (for stats, diff and search). */
export function slideText(slide: Slide, layout?: SlideLayout): string {
  const order = layout ? layout.slots.map((slot) => slot.id) : Object.keys(slide.slots).sort();
  return order
    .map((id) => slide.slots[id]?.trim() ?? '')
    .filter(Boolean)
    .join('\n');
}

/** Slide actions of the carousel copilot ("Reescrever", "Encurtar para caber", "Trocar ponto") and the update to a re-approved article. */
export type SlideAssistAction = 'rewrite' | 'fit' | 'swap' | 'update';

/** Layouts the generator will use for `count` slides: Capa · Contexto · Ponto principal · Citação · Conclusão. */
export function plannedLayouts(template: CarouselTemplate, count: number): SlideLayout[] {
  const total = Math.min(template.maxSlides, Math.max(template.minSlides, count));
  const sequence =
    total <= 3
      ? ['cover', 'point', 'closing'].slice(0, total)
      : total === 4
        ? ['cover', 'point', 'quote', 'closing']
        : ['cover', 'context', 'point', ...Array<string>(total - 5).fill('point'), 'quote', 'closing'];
  return sequence
    .map((id) => findLayout(template, id) ?? findLayout(template, 'point') ?? template.layouts[0])
    .filter((layout): layout is SlideLayout => Boolean(layout));
}

export function findLayout(template: CarouselTemplate | undefined, layoutId: string): SlideLayout | undefined {
  return template?.layouts.find((layout) => layout.id === layoutId);
}

export type SlotIssue = {
  slideId: SlideId;
  slotId: string;
  kind: 'overflow' | 'missing' | 'unknown_layout';
  length?: number;
  maxChars?: number;
  message: string;
};

/** Character-budget issues per slot (hint only; render overflow is reported separately). */
export function slotIssues(body: CarouselBody, template: CarouselTemplate | undefined): SlotIssue[] {
  const issues: SlotIssue[] = [];
  for (const slide of body.slides) {
    const layout = findLayout(template, slide.layout);
    if (!layout) {
      issues.push({ slideId: slide.id, slotId: '', kind: 'unknown_layout', message: 'Layout fora do template.' });
      continue;
    }
    for (const slot of layout.slots) {
      const value = slide.slots[slot.id]?.trim() ?? '';
      if (!value && slot.required) {
        issues.push({ slideId: slide.id, slotId: slot.id, kind: 'missing', message: `${slot.label} vazio.` });
      } else if (value.length > slot.maxChars) {
        issues.push({
          slideId: slide.id,
          slotId: slot.id,
          kind: 'overflow',
          length: value.length,
          maxChars: slot.maxChars,
          message: `${slot.label} excede ${slot.maxChars} caracteres.`,
        });
      }
    }
  }
  return issues;
}
