import { CAROUSEL_FORMATS, FORMAT_SOON_LABEL, TEMPLATE_FAMILIES, categoryLabel, familyLabel, plannedLayouts } from '../../../domain/index.ts';
import type { CarouselFormatId, CarouselTemplate, SlideLayout, SlotSpec, TemplateFamily, TemplateId } from '../../../domain/index.ts';
import type { ProductionListItem } from '../../../ports/production-queries.ts';
import type { RenderedSlide } from '../../../ports/render.ts';
import { applyFilter, coverLayouts, featuredNote, formatFacts, formatName, serializeLibraryParams } from '../../library/library-model.ts';
import type { LibraryFilter, LibraryParams, LibraryTemplate } from '../../library/library-model.ts';
import { TEMPLATES_HREF } from '../routes.ts';

/**
 * "Modelos" in R2 as the screens show it: shelves by family (Notícia, Explica, Podcast), each model
 * a contact sheet of three real pages (the cover, its signature page and the quote), the tabs of the
 * piece kinds and the format switch, the model's own page (every page, the limits of the one on
 * stage, its ficha and the other models) and the productions a carousel can start from. Pure
 * functions over the R1 library model, so `node --test` covers them.
 */

/** What a model needs here: the library card's fields plus its canvas and slide range. */
export type ModelTemplate = LibraryTemplate & Pick<CarouselTemplate, 'width' | 'height' | 'coverLayoutId'>;

// ── Pages of a card ─────────────────────────────────────────────────────────────────────

/**
 * The pages a card shows, in reading order: the cover, the model's signature page (the layout it
 * features, else the first other page over the photo, else "Ponto principal") and the quote. With
 * fewer distinct pages, the next ones of the model fill in.
 */
export function spreadLayouts(template: Pick<CarouselTemplate, 'coverLayoutId' | 'layouts' | 'featuredLayouts'>, size = 3): string[] {
  const has = (id: string | undefined): id is string => Boolean(id && template.layouts.some((layout) => layout.id === id));
  const photo = template.layouts.find((layout) => layout.id !== template.coverLayoutId && layout.articleCover)?.id;
  const signature = (template.featuredLayouts ?? []).find(has) ?? photo ?? 'point';
  const order = [template.coverLayoutId, signature, 'quote', 'point', 'context', ...template.layouts.map((layout) => layout.id)];
  return [...new Set(order.filter(has))].slice(0, size);
}

/** The rendered pages of those layouts, in the same order (a page not drawn yet is left out). */
export function pickPages<S extends Pick<RenderedSlide, 'layout'>>(slides: readonly S[], layouts: readonly string[]): S[] {
  return layouts.flatMap((id) => {
    const slide = slides.find((candidate) => candidate.layout === id);
    return slide ? [slide] : [];
  });
}

// ── Shelves, tabs and format ────────────────────────────────────────────────────────────

export type ShelfId = TemplateFamily | 'other';

export type Shelf<T> = {
  id: ShelfId;
  /** "Notícia"; absent when the format has no family at all (Quadrado). */
  title?: string;
  /** The family's use, without the final period ("Manchetes e reportagens do setor"). */
  meta?: string;
  /** Accessible name of the shelf's list ("Modelos de Notícia"). */
  label: string;
  templates: T[];
};

const OTHER_SHELF = 'Outros';

/**
 * The models of a format that match the search, by family in the library's order. A shelf with no
 * match is left out; models without a family form "Outros" next to other shelves, or a shelf
 * without a heading when they are all there is.
 */
export function familyShelves<T extends LibraryTemplate>(templates: readonly T[], filter: Pick<LibraryFilter, 'format' | 'query'>): Shelf<T>[] {
  const shown = applyFilter(templates, { format: filter.format, query: filter.query });
  const shelves: Shelf<T>[] = TEMPLATE_FAMILIES.flatMap((family) => {
    const members = shown.filter((template) => template.family === family.id);
    return members.length > 0 ? [{ id: family.id, title: family.label, meta: family.use.replace(/\.$/, ''), label: `Modelos de ${family.label}`, templates: members }] : [];
  });
  const rest = shown.filter((template) => !template.family);
  if (rest.length > 0) {
    shelves.push(shelves.length > 0 ? { id: 'other', title: OTHER_SHELF, label: `Modelos de ${OTHER_SHELF}`, templates: rest } : { id: 'other', label: 'Modelos', templates: rest });
  }
  return shelves;
}

/** The piece kinds of the library: carousels now, static posts later ("Em breve"). */
export type PieceTab = 'carousel' | 'static';

export type KindTab = { value: PieceTab; label: string; count: number | string; disabled: boolean };

/** "Carrosséis · 9 | Estáticos · Em breve": the carousel count follows the search across formats. */
export function kindTabs(templates: readonly LibraryTemplate[], query: string): KindTab[] {
  const carousels = CAROUSEL_FORMATS.filter((format) => format.available).reduce((sum, format) => sum + applyFilter(templates, { format: format.id, query }).length, 0);
  return [
    { value: 'carousel', label: 'Carrosséis', count: carousels, disabled: false },
    { value: 'static', label: 'Estáticos', count: FORMAT_SOON_LABEL, disabled: true },
  ];
}

export type FormatOption = { value: CarouselFormatId; label: string; disabled?: boolean; disabledReason?: string };

/** "Feed 4:5 · Quadrado 1:1 · Stories 9:16": a format of a later release is shown, never chosen. */
export function formatOptions(): FormatOption[] {
  return CAROUSEL_FORMATS.map((format) => ({
    value: format.id,
    label: formatName(format),
    ...(format.available ? {} : { disabled: true, disabledReason: FORMAT_SOON_LABEL }),
  }));
}

// ── Addresses ───────────────────────────────────────────────────────────────────────────

type ShownParams = Pick<LibraryParams, 'format' | 'query'>;

/** A model's page, keeping the format and search it was opened from (`?format&q&model`). */
export function modelHref(params: ShownParams, id: TemplateId): string {
  return `${TEMPLATES_HREF}?${serializeLibraryParams({ format: params.format, query: params.query, model: id, family: null })}`;
}

/** The shelves, with that format and search. */
export function libraryHref(params: ShownParams): string {
  const search = serializeLibraryParams({ format: params.format, query: params.query, model: null, family: null });
  return search ? `${TEMPLATES_HREF}?${search}` : TEMPLATES_HREF;
}

// ── Starting a carousel ─────────────────────────────────────────────────────────────────

type TargetProduction = Pick<ProductionListItem, 'archived' | 'stages'>;

/**
 * Productions a carousel can start from: not archived, with a carousel stage that opens (its
 * article approved) and has not started yet.
 */
export function carouselTargets<T extends TargetProduction>(items: readonly T[]): T[] {
  return items.filter((item) => {
    if (item.archived) return false;
    const stage = item.stages.find((candidate) => candidate.kind === 'piece' && candidate.pieceKind === 'carousel');
    return Boolean(stage && stage.selectable && stage.state !== 'blocked' && stage.status === 'not_started');
  });
}

// ── The model's page ────────────────────────────────────────────────────────────────────

/** One page in the DS `Gallery` (the DS `GalleryItem` shape). */
export type GalleryPage = { id: string; src?: string; alt: string; ratio: string; label: string; meta: string };

/** Every rendered page in the model's order, named by its layout ("Capa"). */
export function galleryItems(
  slides: readonly Pick<RenderedSlide, 'layout' | 'width' | 'height' | 'image'>[],
  template: Pick<ModelTemplate, 'name' | 'layouts' | 'formatInfo'>,
): GalleryPage[] {
  return slides.map((slide) => {
    const label = template.layouts.find((layout) => layout.id === slide.layout)?.label ?? slide.layout;
    return {
      id: slide.layout,
      ...(slide.image ? { src: slide.image.dataUrl } : {}),
      alt: `${label} no modelo ${template.name}`,
      ratio: template.formatInfo.ratio,
      label,
      meta: `Prévia · ${slide.width} × ${slide.height} px · PNG`,
    };
  });
}

export type FactRow = { label: string; value: string; hint?: string };

function count(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`;
}

/** "70 caracteres · 3 linhas", "7 caracteres · 1 linha". */
export function slotLimit(slot: Pick<SlotSpec, 'maxChars' | 'maxLines'>): string {
  const chars = count(slot.maxChars, 'caractere', 'caracteres');
  return slot.maxLines ? `${chars} · ${count(slot.maxLines, 'linha', 'linhas')}` : chars;
}

/** What each text of a page holds, and the photo when the page draws the featured image. */
export function layoutLimits(layout: Pick<SlideLayout, 'slots' | 'articleCover'>): FactRow[] {
  return [
    ...layout.slots.map((slot) => ({ label: slot.label, value: slotLimit(slot) })),
    ...(layout.articleCover ? [{ label: 'Foto', value: 'Imagem de destaque' }] : []),
  ];
}

/** The model's ficha: family, style, format, slide range, photo pages and the 5-slide sequence. */
export function modelFacts(template: ModelTemplate): FactRow[] {
  const structure: CarouselTemplate = {
    id: template.id,
    name: template.name,
    width: template.width,
    height: template.height,
    minSlides: template.minSlides,
    maxSlides: template.maxSlides,
    coverLayoutId: template.coverLayoutId,
    layouts: template.layouts,
    ...(template.featuredLayouts ? { featuredLayouts: template.featuredLayouts } : {}),
  };
  const featured = featuredNote(template);
  return [
    ...(template.family ? [{ label: 'Família', value: familyLabel(template.family) }] : []),
    { label: 'Estilo', value: categoryLabel(template.category) },
    { label: 'Formato', value: formatFacts(template.formatInfo) },
    { label: 'Slides', value: `${template.minSlides} a ${template.maxSlides}` },
    { label: 'Imagem de destaque', value: coverLayouts(template) ?? 'Não usa' },
    { label: 'Estrutura', value: plannedLayouts(structure, 5).map((layout) => layout.label).join(' · '), ...(featured ? { hint: featured } : {}) },
  ];
}

/** The other models of the same format, the same family first. */
export function otherModels<T extends LibraryTemplate>(templates: readonly T[], current: Pick<LibraryTemplate, 'id' | 'format' | 'family'>): T[] {
  const others = templates.filter((template) => template.id !== current.id && template.format === current.format);
  const kin = (template: T) => Boolean(current.family) && template.family === current.family;
  return [...others.filter(kin), ...others.filter((template) => !kin(template))];
}
