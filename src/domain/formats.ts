/**
 * Event-coverage formats (João, 2026-10-19): besides the article (Curto/Padrão, unchanged), a
 * production may be written as one of the formats Seafood Brasil publishes during a fair. Each
 * format has its own size options, structure and minimum of literal quotes, measured on the
 * outlet's published texts (APAS Show, Aquishow and IFC Brasil 2026). A brief without `format` is
 * exactly the article of R1.
 *
 * Nothing here is generated: the event data is typed by a person once and reused, and the box
 * that closes a coverage text is built from it, never written by the AI.
 */
import { R1_ARTICLE_LIMITS } from './article-policy.ts';
import { countWords } from './text/stats.ts';
import { charactersAbove, formatLaudasOf, groupDigits, sizeLabel, sizeOf } from './sizing.ts';
import type { ArticleSize } from './sizing.ts';
import type { QuoteRule } from './quote-plan.ts';

export const EDITORIAL_FORMATS = ['stand', 'panel', 'awards', 'opening', 'note'] as const;
export type EditorialFormat = typeof EDITORIAL_FORMATS[number];

export type FormatSizeSpec = {
  id: string;
  /** "Enxuto", "Completo". */
  label: string;
  /** Body characters with spaces the AI writes (the event box is outside the body). */
  minChars: number;
  maxChars: number;
  /** What the AI aims at, leaving room for the human edit. */
  targetChars: number;
  /** Parts after the opening: intertítulos when the format has them. */
  sections: { min: number; max: number; default: number };
};

export type EditorialFormatSpec = {
  id: EditorialFormat;
  /** "Cobertura de estande". */
  label: string;
  /** One line in the pauta's choice. */
  summary: string;
  sizes: readonly FormatSizeSpec[];
  defaultSize: string;
  /** Parts become H2 intertítulos; without them they only guide the drafting. */
  headings: boolean;
  /** Distinct literal quotes of four words or more the body needs. */
  minQuotes: number;
  /** The opening carries a quotation when its evidence has a quotable line (the stand's spokesperson). */
  openingQuote: boolean;
  /** Each part after the opening carries a quotation when its evidence has a quotable line. */
  sectionQuotes: boolean;
  /** Share of the target the opening takes. */
  introShare: number;
};

const size = (id: string, label: string, minChars: number, maxChars: number, sections: FormatSizeSpec['sections']): FormatSizeSpec =>
  ({ id, label, minChars, maxChars, targetChars: Math.round(maxChars * 0.9), sections });

export const FORMAT_SPECS: Readonly<Record<EditorialFormat, EditorialFormatSpec>> = {
  stand: {
    id: 'stand', label: 'Cobertura de estande', summary: 'Empresa no evento: novidade, porta-voz e mercado.',
    sizes: [size('compact', 'Enxuto', 1200, 2300, { min: 1, max: 2, default: 1 }), size('full', 'Completo', 2300, 3600, { min: 2, max: 3, default: 2 })],
    defaultSize: 'full', headings: true, minQuotes: 2, openingQuote: true, sectionQuotes: true, introShare: 0.22,
  },
  panel: {
    id: 'panel', label: 'Cobertura de painel', summary: 'Quem disse o quê numa palestra ou painel.',
    sizes: [size('standard', 'Padrão', 2800, 4500, { min: 2, max: 4, default: 3 }), size('full', 'Completo', 4500, 7500, { min: 3, max: 6, default: 4 })],
    defaultSize: 'standard', headings: true, minQuotes: 3, openingQuote: false, sectionQuotes: true, introShare: 0.15,
  },
  awards: {
    id: 'awards', label: 'Premiação', summary: 'Vencedores por categoria, do material oficial.',
    sizes: [size('standard', 'Padrão', 900, 2800, { min: 1, max: 6, default: 3 })],
    defaultSize: 'standard', headings: true, minQuotes: 0, openingQuote: false, sectionQuotes: false, introShare: 0.3,
  },
  opening: {
    id: 'opening', label: 'Abertura', summary: 'Cerimônia de abertura: anúncios e autoridades.',
    sizes: [size('standard', 'Padrão', 2800, 5000, { min: 2, max: 5, default: 3 })],
    defaultSize: 'standard', headings: true, minQuotes: 2, openingQuote: false, sectionQuotes: true, introShare: 0.18,
  },
  note: {
    id: 'note', label: 'Nota curta', summary: 'Um fato, sem intertítulo.',
    sizes: [size('standard', 'Padrão', 600, 1500, { min: 1, max: 2, default: 1 })],
    defaultSize: 'standard', headings: false, minQuotes: 0, openingQuote: false, sectionQuotes: true, introShare: 0.5,
  },
};

export function isEditorialFormat(value: unknown): value is EditorialFormat {
  return typeof value === 'string' && (EDITORIAL_FORMATS as readonly string[]).includes(value);
}

/** The format's size option; an unknown id reads as the format's default. */
export function formatSizeOf(format: EditorialFormat, sizeId?: string): FormatSizeSpec {
  const spec = FORMAT_SPECS[format];
  return spec.sizes.find((candidate) => candidate.id === sizeId) ?? spec.sizes.find((candidate) => candidate.id === spec.defaultSize)!;
}

/**
 * The event of a coverage, as the reporter typed it. It feeds the closing box and the service
 * lines, and its words count as known facts for the grounding check: nothing else about the
 * event (numbers, theme, edition) may appear unless the material says it.
 */
export type EventContext = {
  /** "Seafood Show Latin America 2026". */
  name: string;
  /** Heading of the closing box: "Seafood Brasil e o pescado na Seafood Show Latin America 2026". */
  boxTitle?: string;
  /** The box's paragraph about the event, written by the reporter. */
  about?: string;
  /** "De 20 a 22 de outubro de 2026". */
  dates?: string;
  /** "Das 13h às 20h". */
  hours?: string;
  /** "Distrito Anhembi". */
  venue?: string;
  /** "Av. Olavo Fontoura, 1209 – Santana – São Paulo/SP". */
  address?: string;
  /** Last line: "Acompanhe nossa cobertura especial no site e nas redes sociais." */
  cta?: string;
};

export const EVENT_FIELDS: readonly (keyof EventContext)[] = ['name', 'boxTitle', 'about', 'dates', 'hours', 'venue', 'address', 'cta'];
export const EVENT_FIELD_MAX = 600;

/** Trimmed fields only; an event without a name is no event. */
export function normalizeEvent(event: Partial<EventContext> | undefined): EventContext | undefined {
  if (!event) return undefined;
  const entries = EVENT_FIELDS.flatMap((key) => {
    const value = typeof event[key] === 'string' ? event[key]!.trim().slice(0, EVENT_FIELD_MAX) : '';
    return value ? [[key, value] as const] : [];
  });
  const normalized = Object.fromEntries(entries) as Partial<EventContext>;
  return normalized.name ? (normalized as EventContext) : undefined;
}

/** One line of the closing box: a heading, a paragraph or a service line ("Data: …"). */
export type EventBoxLine = { kind: 'heading' | 'paragraph' | 'divider' | 'service' | 'label'; text: string };

/**
 * The box that closes a coverage text on the outlet's site: a heading, the paragraph about the
 * event, the service lines and the call to follow the coverage. Built only from the event data.
 */
export function eventBoxLines(event: EventContext | undefined): EventBoxLine[] {
  if (!event || ![event.about, event.dates, event.hours, event.venue, event.address, event.cta].some(value => value?.trim())) return [];
  const lines: EventBoxLine[] = [{ kind: 'heading', text: event.boxTitle ?? `Seafood Brasil na ${event.name}` }];
  if (event.about) lines.push({ kind: 'paragraph', text: event.about });
  const service = ([['Data', event.dates], ['Horário', event.hours], ['Local', event.venue], ['Endereço', event.address]] as const)
    .filter(([, value]) => Boolean(value));
  if (service.length) {
    lines.push({ kind: 'divider', text: '—' }, { kind: 'label', text: event.name.toLocaleUpperCase('pt-BR') });
    // A value typed with its own label ("Data: de 20 a 22…") keeps one label only.
    for (const [label, value] of service) lines.push({ kind: 'service', text: `${label}: ${value!.replace(new RegExp(`^${label}\\s*:\\s*`, 'iu'), '')}` });
  }
  if (event.cta) lines.push({ kind: 'paragraph', text: event.cta });
  return lines;
}

/** The fields of a brief this module reads (structural, so `production.ts` can import it). */
export type FormatBrief = { format?: EditorialFormat; formatSize?: string; event?: EventContext };

/** Length and quote rules a body must meet: R1's for the article, the format's otherwise. */
export type ArticleContract = {
  minChars: number;
  maxChars: number;
  targetChars: number;
  minWords?: number;
  maxWords?: number;
  targetWords?: number;
  minQuotes: number;
};

export function articleContractFor(brief: FormatBrief): ArticleContract {
  if (!brief.format) return { ...R1_ARTICLE_LIMITS };
  const spec = FORMAT_SPECS[brief.format], option = formatSizeOf(brief.format, brief.formatSize);
  return { minChars: option.minChars, maxChars: option.maxChars, targetChars: option.targetChars, minQuotes: spec.minQuotes };
}

/** Where a text wants quotations: R1's article in its sections, a format as its spec says. */
export function quoteRuleFor(brief: FormatBrief): QuoteRule {
  if (!brief.format) return { minQuotes: R1_ARTICLE_LIMITS.minQuotes, openingQuote: false, sectionQuotes: true };
  const spec = FORMAT_SPECS[brief.format];
  return { minQuotes: spec.minQuotes, openingQuote: spec.openingQuote, sectionQuotes: spec.sectionQuotes };
}

/**
 * What blocks a text: R1's limits for the article; for a format, its ceiling and its quotes. A
 * format's minimum guides the writing but never fails it: when the material gives less, the text
 * comes out shorter (never padded) and "Tamanho" says so.
 */
export function articleGateFor(brief: FormatBrief): ArticleContract | Omit<ArticleContract, 'minChars'> {
  if (!brief.format) return articleContractFor(brief);
  const contract = articleContractFor(brief);
  return { maxChars: contract.maxChars, targetChars: contract.targetChars, minQuotes: contract.minQuotes };
}

/** "Cobertura de estande · Completo", or undefined for the article. */
export function formatLabel(brief: FormatBrief): string | undefined {
  if (!brief.format) return undefined;
  const spec = FORMAT_SPECS[brief.format];
  return spec.sizes.length > 1 ? `${spec.label} · ${formatSizeOf(brief.format, brief.formatSize).label}` : spec.label;
}

/** Minutes of speech from which a stand interview fills "Completo" (the reporters record 3 to 5 min). */
export const STAND_FULL_MINUTES = 3;

/**
 * Minutes of speech in a material: its words at 150 per minute, capped by the recorded duration. The
 * duration is the last timestamp, so an excerpt cut from a longer recording would overstate it alone.
 */
export function materialMinutes(stats: { durationMs?: number; words: number }): number {
  const spoken = stats.words / 150;
  return stats.durationMs !== undefined ? Math.min(spoken, stats.durationMs / 60000) : spoken;
}

/** "Completo" when a stand interview of 3 min or more is set to a smaller size; otherwise nothing. */
export function suggestedFormatSize(format: EditorialFormat | undefined, sizeId: string | undefined, minutes: number | undefined): FormatSizeSpec | undefined {
  if (format !== 'stand' || minutes === undefined || minutes < STAND_FULL_MINUTES) return undefined;
  const full = FORMAT_SPECS.stand.sizes.find(size => size.id === 'full');
  return full && formatSizeOf('stand', sizeId).id !== full.id ? full : undefined;
}

/** "1.200–2.300 caracteres": a format size's range, as the pauta shows it. */
export function formatRangeLabel(option: FormatSizeSpec): string {
  return `${groupDigits(option.minChars)}–${groupDigits(option.maxChars)} caracteres`;
}

/** A brief as the size displays read it: the article size, or a format and its option. */
export type SizedBrief = FormatBrief & { size: ArticleSize };

/** The most characters the brief's text should have: the format option's, or the lauda size's. */
export function briefMaxChars(brief: SizedBrief): number {
  return brief.format ? formatSizeOf(brief.format, brief.formatSize).maxChars : sizeOf(brief.size).maxChars;
}

/** Characters past that maximum; 0 inside it. */
export function briefCharactersAbove(chars: number, brief: SizedBrief): number {
  return brief.format ? Math.max(0, Math.round(chars) - briefMaxChars(brief)) : charactersAbove(chars, brief.size);
}

/** "1,4 de 2 laudas" for the article; "2.140 de 2.300 caracteres" for a format, sized in characters. */
export function briefSizeProgress(chars: number, brief: SizedBrief): string {
  return brief.format ? `${groupDigits(chars)} de ${groupDigits(briefMaxChars(brief))} caracteres` : formatLaudasOf(chars, brief.size);
}

/** "Padrão · 2 laudas", or the format's name: "Cobertura de estande · Completo". */
export function briefSizeName(brief: SizedBrief): string {
  return formatLabel(brief) ?? sizeLabel(brief.size);
}

/**
 * The outlet's punctuation after a quotation: “fala”, explicou — never “fala.”, explicou. Only the
 * closing period moves; "?" and "!" carry meaning and stay. The literal-quote check accepts it.
 */
export function outletPunctuation(text: string): string {
  // A sentence that opens a list ends with a colon; the output contract still appends a stop.
  return text.replace(/\.”,/g, '”,').replace(/([.!?])”\./g, '$1”').replace(/:\s*\.(?=\s|$)/g, ':');
}

/**
 * Spoken openers a quotation drops at its start without changing what was said: "Então" and, only
 * when a comma marks them as fillers, "Bom," "Olha," "Ou seja," "Né," "Enfim," "Aí,". "Bom produto…",
 * "Olha só o tamanho…" or "Aí está…" carry meaning and stay.
 */
const QUOTE_OPENERS = /^(?:então(?:,\s*|\s+)|(?:bom|olha|ou seja|né|enfim|e aí|aí),\s*)+/iu;

/**
 * A quotation of an event text opens on its first real word: a leading "Então," or "Bom," goes when
 * four words or more remain, and a quotation that opens a sentence starts with a capital. The words
 * stay the source's: the literal check allows only that capital (article-policy.ts).
 */
export function tidyQuoteOpenings(text: string): string {
  return text.replace(/(^|[.!?:]\s+|\s)“([^”]+)”/gu, (_match, before: string, quote: string) => {
    const trimmed = quote.replace(QUOTE_OPENERS, '');
    const kept = trimmed !== quote && countWords(trimmed) >= 4 ? trimmed : quote;
    const opensSentence = before === '' || /[.!?:]\s+$/u.test(before);
    return `${before}“${opensSentence ? kept.charAt(0).toLocaleUpperCase('pt-BR') + kept.slice(1) : kept}”`;
  });
}
