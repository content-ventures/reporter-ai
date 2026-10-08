import type { CarouselTemplate, TemplateId } from '../../domain/index.ts';
import type { TemplateRender } from '../../ports/render-template.ts';
import { DEFAULT_TEMPLATE_ID, EDITORIAL_TEMPLATE_ID, NOTURNO_TEMPLATE_ID, TEMPLATE_CATALOG } from './catalog.ts';

/**
 * The first two models (Editorial and Noturno, accepted for R1 · Experiência, D09) under the
 * names the stories and older tests import. They are library entries like any other
 * (`catalog.ts`); their ids stay, so carousels saved with them still open.
 */

export { DEFAULT_TEMPLATE_ID };
export const NEUTRAL_LIGHT_TEMPLATE_ID: TemplateId = EDITORIAL_TEMPLATE_ID;
export const NEUTRAL_DARK_TEMPLATE_ID: TemplateId = NOTURNO_TEMPLATE_ID;

const FIRST = TEMPLATE_CATALOG.filter((entry) => entry.template.id === EDITORIAL_TEMPLATE_ID || entry.template.id === NOTURNO_TEMPLATE_ID);

export const PROVISIONAL_TEMPLATES: readonly CarouselTemplate[] = FIRST.map((entry) => entry.template);

export const TEMPLATE_RENDERS: Readonly<Record<TemplateId, TemplateRender>> = Object.fromEntries(FIRST.map((entry) => [entry.template.id, entry.render]));

export const TEMPLATE_DESCRIPTIONS: Readonly<Record<TemplateId, string>> = Object.fromEntries(FIRST.map((entry) => [entry.template.id, entry.meta.description]));

export type { LayoutRender, SlotStyle, TemplateRender } from '../../ports/render-template.ts';
