import { CAROUSEL_FORMATS, FORMAT_SOON_LABEL, TEMPLATE_STATUS_LABELS, categoryLabel, filterTemplates, formatSize } from '../../domain/index.ts';
import type {
  CarouselFormat,
  CarouselFormatId,
  CarouselTemplate,
  SlotSpec,
  TemplateId,
  TemplateMeta,
  TemplateStatus,
  TemplateSwitchIssue,
} from '../../domain/index.ts';

/**
 * Carousel template library (F1.5) as the screens show it: the line under a card's name, the
 * "Aprovado" badge, the format tabs with their counts, the URL of the "Modelos" page, each
 * layout's limits and what a switch of model changes. One format is shown at a time (a carousel is
 * Feed or Quadrado before anything else), so every card of a grid shares its proportion. Pure
 * functions only, so `node --test` covers them; the cards, filters and drawers compose the DS
 * around these values.
 */

/** What a card needs from a template (`TemplateInfo` satisfies it). */
export type LibraryTemplate = Pick<CarouselTemplate, 'id' | 'name' | 'layouts' | 'minSlides' | 'maxSlides' | 'featuredLayouts'> &
  TemplateMeta & { formatInfo: CarouselFormat };

/** "Feed 4:5". */
export function formatName(format: Pick<CarouselFormat, 'label' | 'ratioLabel'>): string {
  return `${format.label} ${format.ratioLabel}`;
}

/** What the model is, for the drawer: "Editorial · Feed 4:5". */
export function templateLine(template: Pick<LibraryTemplate, 'category' | 'formatInfo'>): string {
  return `${categoryLabel(template.category)} · ${formatName(template.formatInfo)}`;
}

/** "Feed 4:5 · 1080 × 1350 px". */
export function formatFacts(format: CarouselFormat): string {
  return `${formatName(format)} · ${formatSize(format)}`;
}

/**
 * The badge a model carries: only "Aprovado" (Marketing approved it, teal). The models the product
 * ships with carry none — "Modelo base" on every card says nothing about the choice.
 */
export function statusBadge(status: TemplateStatus): { label: string; tone: 'teal' } | undefined {
  return status === 'aprovado' ? { label: TEMPLATE_STATUS_LABELS.aprovado, tone: 'teal' } : undefined;
}

// ── Filters ─────────────────────────────────────────────────────────────────────────────

export type LibraryFilter = { format: CarouselFormatId; query: string };

/** The first format a carousel can use (Feed). */
export const FIRST_FORMAT: CarouselFormatId = (CAROUSEL_FORMATS.find((format) => format.available) ?? CAROUSEL_FORMATS[0]).id;

/** A fresh filter on a format (the model being edited or chosen decides which). */
export function libraryFilter(format: CarouselFormatId = FIRST_FORMAT): LibraryFilter {
  return { format, query: '' };
}

export function applyFilter<T extends LibraryTemplate>(templates: readonly T[], filter: LibraryFilter): T[] {
  return filterTemplates(templates, { format: filter.format, ...(filter.query.trim() ? { query: filter.query } : {}) });
}

export type FormatTab = { value: CarouselFormatId; label: string; count: number | string; disabled: boolean };

/**
 * "Feed 4:5 · Quadrado 1:1 · Stories 9:16". Counts follow the search; a format of a later release
 * is listed as "Em breve" and never opens.
 */
export function formatTabs(templates: readonly LibraryTemplate[], filter: LibraryFilter): FormatTab[] {
  return CAROUSEL_FORMATS.map((format) => ({
    value: format.id,
    label: formatName(format),
    count: format.available ? applyFilter(templates, { ...filter, format: format.id }).length : FORMAT_SOON_LABEL,
    disabled: !format.available,
  }));
}

/** Where a search with nothing in the chosen format finds models: the first other format with any. */
export function otherFormatMatch(templates: readonly LibraryTemplate[], filter: LibraryFilter): FormatTab | undefined {
  return formatTabs(templates, filter).find((tab) => tab.value !== filter.format && !tab.disabled && typeof tab.count === 'number' && tab.count > 0);
}

/** The library order with the first available model first when nothing is chosen yet. */
export function initialTemplate(
  templates: readonly Pick<LibraryTemplate, 'id' | 'formatInfo'>[],
  { existing, lastUsed }: { existing?: TemplateId; lastUsed?: string | null },
): TemplateId | undefined {
  const usable = (id: string | null | undefined) => templates.find((template) => template.id === id && template.formatInfo.available)?.id;
  return usable(existing) ?? usable(lastUsed) ?? templates.find((template) => template.formatInfo.available)?.id;
}

// ── "Modelos" page URL ───────────────────────────────────────────────────────────────────

/** `format: null`: none in the address (the open model's format, else the first one). */
export type LibraryParams = { format: CarouselFormatId | null; query: string; model: TemplateId | null };

export const DEFAULT_LIBRARY_PARAMS: LibraryParams = Object.freeze({ format: null, query: '', model: null });

type SearchParamsLike = { get(name: string): string | null };

const FORMAT_IDS = new Set<string>(CAROUSEL_FORMATS.filter((format) => format.available).map((format) => format.id));

/** `?format=square&q=foto&model=tpl-aspas`; anything unknown falls back to the default. */
export function parseLibraryParams(search: SearchParamsLike): LibraryParams {
  const format = search.get('format');
  const model = search.get('model');
  return {
    format: format && FORMAT_IDS.has(format) ? (format as CarouselFormatId) : null,
    query: (search.get('q') ?? '').slice(0, 80),
    model: model ? model : null,
  };
}

/** Defaults are left out, so the plain library is `/library/templates`. */
export function serializeLibraryParams(params: LibraryParams): string {
  const search = new URLSearchParams();
  if (params.format) search.set('format', params.format);
  if (params.query.trim()) search.set('q', params.query.trim());
  if (params.model) search.set('model', params.model);
  return search.toString();
}

/** The format the page shows: the address's, else the open model's, else the first one. */
export function shownFormat(params: Pick<LibraryParams, 'format' | 'model'>, templates: readonly Pick<LibraryTemplate, 'id' | 'format'>[]): CarouselFormatId {
  return params.format ?? templates.find((template) => template.id === params.model)?.format ?? FIRST_FORMAT;
}

// ── Layouts and limits ───────────────────────────────────────────────────────────────────

/** "Título até 70 caracteres e 3 linhas", "Número até 7 caracteres". */
export function slotLimit(slot: Pick<SlotSpec, 'label' | 'maxChars' | 'maxLines'>): string {
  const lines = slot.maxLines && slot.maxLines > 1 ? ` e ${slot.maxLines} linhas` : '';
  return `${slot.label} até ${slot.maxChars} caracteres${lines}`;
}

/** "Capa, Citação e Conclusão". */
function listText(labels: readonly string[]): string {
  return labels.length > 1 ? `${labels.slice(0, -1).join(', ')} e ${labels[labels.length - 1]}` : (labels[0] ?? '');
}

/** Layouts that draw the article's featured image ("Capa, Citação e Conclusão"), or undefined. */
export function coverLayouts(template: Pick<LibraryTemplate, 'layouts'>): string | undefined {
  const labels = template.layouts.filter((layout) => layout.articleCover).map((layout) => layout.label);
  return labels.length > 0 ? listText(labels) : undefined;
}

/** The slide a featured layout adds, by its id: what the generation needs from the article for it. */
const FEATURED_REASON: Readonly<Record<string, string>> = {
  data: 'Com um dado forte, gera um slide de',
  list: 'Com uma lista no artigo, gera um slide de',
};

/** "Com um dado forte, gera um slide de Número." when the model features a layout the generation fills from the article. */
export function featuredNote(template: Pick<LibraryTemplate, 'layouts' | 'featuredLayouts'>): string | undefined {
  const notes = (template.featuredLayouts ?? []).flatMap((id) => {
    const label = template.layouts.find((layout) => layout.id === id)?.label;
    return label ? [`${FEATURED_REASON[id] ?? 'Pode gerar um slide de'} ${label}.`] : [];
  });
  return notes.length > 0 ? notes.join(' ') : undefined;
}

// ── Switching the model of a carousel ────────────────────────────────────────────────────

export type SwitchSummary = {
  /** Texts the new model measures past their lines or budget (approximate). */
  overflow: number;
  /** Texts with no place in the new model (kept in a saved version before switching). */
  dropped: number;
  /** Required fields left empty. */
  missing: number;
  /** One line for the picker's footer: "≈ 2 textos não cabem", "Tudo cabe no modelo". */
  text: string;
  tone: 'ok' | 'warning';
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** What switching changes, counted once per slot (the measured fit wins over the character hint). */
export function switchSummary(issues: readonly TemplateSwitchIssue[]): SwitchSummary {
  const slots = (kinds: readonly TemplateSwitchIssue['kind'][]) =>
    new Set(issues.filter((issue) => kinds.includes(issue.kind)).map((issue) => `${issue.slideId}\u0001${issue.slotId ?? ''}`)).size;
  const overflow = slots(['overflow', 'over_budget']);
  const dropped = issues.filter((issue) => issue.kind === 'dropped').length;
  const missing = slots(['missing']);
  const parts = [
    dropped > 0 ? plural(dropped, 'texto fica de fora', 'textos ficam de fora') : null,
    overflow > 0 ? `≈ ${plural(overflow, 'texto não cabe', 'textos não cabem')}` : null,
    missing > 0 ? plural(missing, 'campo obrigatório vazio', 'campos obrigatórios vazios') : null,
  ].filter((part): part is string => Boolean(part));
  return {
    overflow,
    dropped,
    missing,
    text: parts.length > 0 ? parts.join(' · ') : 'Os textos cabem no modelo',
    tone: parts.length > 0 ? 'warning' : 'ok',
  };
}

/** The issues worth a line in the detail of a switch: what moves, joins, is left out or does not fit. */
export function switchLines(issues: readonly TemplateSwitchIssue[]): string[] {
  return issues.map((issue) => issue.message);
}
