import type { CarouselTemplate } from './carousel.ts';

/**
 * Carousel template LIBRARY vocabulary (F1.5): formats, categories and status of the models the
 * studio offers. Templates are data (D07); this module only names what a card shows and lets the
 * library be filtered. Marketing's approved models arrive as `status: 'aprovado'`; the models the
 * product ships with are `'base'` ("Modelo base"), never called provisional on a screen (D09).
 */

export type CarouselFormatId = 'feed' | 'square' | 'stories';

export type CarouselFormat = {
  id: CarouselFormatId;
  /** "Feed", "Quadrado", "Stories". */
  label: string;
  /** Proportion as the DS `MediaFrame` takes it ("4/5"). */
  ratio: string;
  /** "4:5". */
  ratioLabel: string;
  width: number;
  height: number;
  /** Release that brings the format. */
  since: 'R1' | 'R6';
  /** Selectable now; a later format is listed as "Em breve" and has no templates yet. */
  available: boolean;
};

/** In library order. Stories (9:16) arrive with distribution (R6): listed, never selectable. */
export const CAROUSEL_FORMATS: readonly CarouselFormat[] = [
  { id: 'feed', label: 'Feed', ratio: '4/5', ratioLabel: '4:5', width: 1080, height: 1350, since: 'R1', available: true },
  { id: 'square', label: 'Quadrado', ratio: '1/1', ratioLabel: '1:1', width: 1080, height: 1080, since: 'R1', available: true },
  { id: 'stories', label: 'Stories', ratio: '9/16', ratioLabel: '9:16', width: 1080, height: 1920, since: 'R6', available: false },
];

/** Label of a format that is not selectable yet. */
export const FORMAT_SOON_LABEL = 'Em breve';

export function formatById(id: CarouselFormatId): CarouselFormat | undefined {
  return CAROUSEL_FORMATS.find((format) => format.id === id);
}

/** The format of a template, from its canvas size. */
export function formatOf(template: Pick<CarouselTemplate, 'width' | 'height'>): CarouselFormat | undefined {
  return CAROUSEL_FORMATS.find((format) => format.width === template.width && format.height === template.height);
}

/** "1080 × 1350 px". */
export function formatSize(format: Pick<CarouselFormat, 'width' | 'height'>): string {
  return `${format.width} × ${format.height} px`;
}

export type TemplateCategory = 'editorial' | 'magazine' | 'photo' | 'quote' | 'data' | 'list' | 'bold' | 'minimal';

/** Categories in library order, with their pt-BR labels (filter chips). */
export const TEMPLATE_CATEGORIES: readonly { id: TemplateCategory; label: string }[] = [
  { id: 'editorial', label: 'Editorial' },
  { id: 'magazine', label: 'Revista' },
  { id: 'photo', label: 'Foto em destaque' },
  { id: 'quote', label: 'Citação' },
  { id: 'data', label: 'Dados' },
  { id: 'list', label: 'Passo a passo' },
  { id: 'bold', label: 'Contraste' },
  { id: 'minimal', label: 'Minimal' },
];

export function categoryLabel(id: TemplateCategory): string {
  return TEMPLATE_CATEGORIES.find((category) => category.id === id)?.label ?? id;
}

/** `aprovado`: a model Marketing approved; `base`: a model the product ships with. */
export type TemplateStatus = 'aprovado' | 'base';

export const TEMPLATE_STATUS_LABELS: Readonly<Record<TemplateStatus, string>> = {
  aprovado: 'Aprovado',
  base: 'Modelo base',
};

/** What the library card of a template shows and filters by. */
export type TemplateMeta = {
  category: TemplateCategory;
  format: CarouselFormatId;
  /** pt-BR one-liner. */
  description: string;
  /** Search words ("claro", "serifa", "foto"). */
  tags: string[];
  status: TemplateStatus;
};

/** True when a layout of the template draws the article's featured image. */
export function usesArticleCover(template: Pick<CarouselTemplate, 'layouts'>): boolean {
  return template.layouts.some((layout) => layout.articleCover === true);
}

/** Lower case, no accents: "Citação" matches "citacao". */
function fold(text: string): string {
  return text.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{M}/gu, '');
}

export type TemplateFilter = { format?: CarouselFormatId; category?: TemplateCategory; status?: TemplateStatus; query?: string };

/**
 * Library filter: format, category and status match exactly; the query matches every word against
 * the name, description, tags and category label, ignoring case and accents. Order is kept.
 */
export function filterTemplates<T extends Pick<CarouselTemplate, 'name'> & TemplateMeta>(templates: readonly T[], filter: TemplateFilter): T[] {
  const words = fold(filter.query ?? '')
    .split(/\s+/)
    .filter(Boolean);
  return templates.filter((template) => {
    if (filter.format && template.format !== filter.format) return false;
    if (filter.category && template.category !== filter.category) return false;
    if (filter.status && template.status !== filter.status) return false;
    if (words.length === 0) return true;
    const haystack = fold([template.name, template.description, categoryLabel(template.category), ...template.tags].join(' '));
    return words.every((word) => haystack.includes(word));
  });
}
