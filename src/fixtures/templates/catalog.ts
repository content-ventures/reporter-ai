import type { CarouselTemplate, TemplateId } from '../../domain/index.ts';
import { PROVISIONAL_TEMPLATES, TEMPLATE_DESCRIPTIONS, TEMPLATE_RENDERS } from './provisional.ts';
import type { TemplateRender } from './provisional.ts';

/**
 * Carousel template catalogue (F1.5, D07/D09). A template is DATA in three parts: the structure
 * (layouts, slots, limits), the render data (boxes, fonts, colours) and a pt-BR one-liner for the
 * ChoiceCard. Marketing's approved models arrive as entries appended here, and nothing else
 * changes: the start page lists them, the studio's "Modelo" menu switches between them and the
 * RenderService draws, measures and exports them (`catalog.test.ts` checks every entry).
 */

export type TemplateEntry = { template: CarouselTemplate; render: TemplateRender; description: string };

function provisionalEntry(template: CarouselTemplate): TemplateEntry {
  const render = TEMPLATE_RENDERS[template.id];
  const description = TEMPLATE_DESCRIPTIONS[template.id];
  if (!render || !description) throw new Error(`template ${template.id} without render data or description`);
  return { template, render, description };
}

export const TEMPLATE_CATALOG: readonly TemplateEntry[] = [...PROVISIONAL_TEMPLATES.map(provisionalEntry)];

/** Structures, in the order the studio offers them (the first is the default). */
export const CAROUSEL_TEMPLATES: readonly CarouselTemplate[] = TEMPLATE_CATALOG.map((entry) => entry.template);

export const CAROUSEL_TEMPLATE_RENDERS: Readonly<Record<TemplateId, TemplateRender>> = Object.fromEntries(
  TEMPLATE_CATALOG.map((entry) => [entry.template.id, entry.render]),
);

export const CAROUSEL_TEMPLATE_DESCRIPTIONS: Readonly<Record<TemplateId, string>> = Object.fromEntries(
  TEMPLATE_CATALOG.map((entry) => [entry.template.id, entry.description]),
);
