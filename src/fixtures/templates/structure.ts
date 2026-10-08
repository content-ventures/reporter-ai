import type { CarouselTemplate, SlideLayout, SlotSpec } from '../../domain/index.ts';
import type { TemplateId } from '../../domain/index.ts';
import type { Canvas } from './kit.ts';

/**
 * Structure every library template shares: the same layouts, slot ids, roles and character
 * budgets, so switching models keeps every text in its slot and only the line fit (the visual
 * data) differs. Layouts in reading order: Capa · Contexto · Ponto principal · Número · Lista ·
 * Citação · Conclusão. `data` and `list` exist in every model; the generation places them only
 * in the models that feature them (`featuredLayouts`) and only when the article has the material.
 */

export type StructureOptions = {
  /** Layouts that draw the article's featured image. */
  photo?: readonly ('cover' | 'quote' | 'closing')[];
  /** Lines of the cover title (default 3). */
  coverTitleLines?: number;
  featured?: readonly ('data' | 'list')[];
};

function slot(id: string, label: string, role: SlotSpec['role'], maxChars: number, maxLines: number, required = false): SlotSpec {
  return { id, label, role, maxChars, maxLines, ...(required ? { required: true } : {}) };
}

function layouts(options: StructureOptions): SlideLayout[] {
  const photo = new Set(options.photo ?? []);
  const withPhoto = (layout: SlideLayout, id: 'cover' | 'quote' | 'closing'): SlideLayout => (photo.has(id) ? { ...layout, articleCover: true } : layout);
  return [
    withPhoto(
      {
        id: 'cover',
        label: 'Capa',
        slots: [slot('kicker', 'Chamada', 'kicker', 32, 1), slot('title', 'Título', 'title', 70, options.coverTitleLines ?? 3, true)],
      },
      'cover',
    ),
    { id: 'context', label: 'Contexto', slots: [slot('title', 'Título', 'title', 40, 2), slot('body', 'Texto', 'body', 200, 6, true)] },
    { id: 'point', label: 'Ponto principal', slots: [slot('title', 'Título', 'title', 40, 2, true), slot('body', 'Texto', 'body', 200, 6)] },
    {
      id: 'data',
      label: 'Número',
      slots: [slot('title', 'Título', 'title', 40, 2), slot('stat', 'Número', 'stat', 7, 1, true), slot('body', 'Texto', 'body', 140, 4, true)],
    },
    { id: 'list', label: 'Lista', slots: [slot('title', 'Título', 'title', 50, 2), slot('items', 'Itens', 'list', 180, 6, true)] },
    withPhoto({ id: 'quote', label: 'Citação', slots: [slot('quote', 'Citação', 'quote', 140, 5, true), slot('attribution', 'Crédito', 'attribution', 60, 2)] }, 'quote'),
    withPhoto(
      {
        id: 'closing',
        label: 'Conclusão',
        slots: [slot('title', 'Título', 'title', 50, 2, true), slot('body', 'Texto', 'body', 160, 5), slot('cta', 'Chamada final', 'cta', 32, 1)],
      },
      'closing',
    ),
  ];
}

export function structure(id: TemplateId, name: string, canvas: Canvas, options: StructureOptions = {}): CarouselTemplate {
  const template: CarouselTemplate = {
    id,
    name,
    width: canvas.width,
    height: canvas.height,
    minSlides: 3,
    maxSlides: 10,
    coverLayoutId: 'cover',
    layouts: layouts(options),
  };
  if (options.featured?.length) template.featuredLayouts = [...options.featured];
  return template;
}
