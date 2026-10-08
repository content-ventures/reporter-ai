/**
 * Article size by LAUDA (João, 2026-10-08): "Tamanho do artigo: curto ou padrão". One lauda is
 * `CHARS_PER_LAUDA` characters with spaces, counted on the BODY only (paragraphs, intertítulos,
 * quotes, lists; never the title, captions, credits, alt text or image slots). Every range,
 * target and section budget derives from that single constant. The size never forces the AI to
 * pad: a material that gives less yields a shorter text, and the check only informs.
 */

/** Characters with spaces per lauda (body only). João's 1.000–4.000 for 1–2 laudas. */
export const CHARS_PER_LAUDA = 2000;

/**
 * Characters per word in pt-BR (measured on our texts), for internal word budgets only: the
 * guard is always characters, and word estimates are never shown next to a size.
 */
export const CHARS_PER_WORD = 5.8;

export type ArticleSize = 'short' | 'standard';

/** Display order of the size options (Curto first). */
export const ARTICLE_SIZE_IDS: readonly ArticleSize[] = ['short', 'standard'];

/** New productions start as Padrão: an interview carries quotes and context. */
export const DEFAULT_ARTICLE_SIZE: ArticleSize = 'standard';

/** A generated draft aims at `targetChars` ± this share, and never goes above `maxChars`. */
export const SIZE_TOLERANCE = 0.1;

export type SectionRange = { min: number; max: number; default: number };

export type ArticleSizeSpec = {
  id: ArticleSize;
  /** "Curto", "Padrão". */
  label: string;
  laudas: number;
  /** Inclusive character range the check passes in. */
  minChars: number;
  maxChars: number;
  /** What the AI aims at (0.9 × max), leaving room for the human edit. */
  targetChars: number;
  /** Sections after the introduction. */
  sections: SectionRange;
  /** Sections become H2 intertítulos (Padrão); in a Curto they only guide the drafting. */
  headings: boolean;
  /** Share of the target the introduction takes. */
  introShare: number;
  /** pt-BR option text: "Notícia direta: um fato, pouco contexto. Até 2.000 caracteres." */
  description: string;
};

/** "4.000": integer with pt-BR thousands. */
export function groupDigits(value: number): string {
  const sign = value < 0 ? '-' : '';
  return sign + String(Math.abs(Math.round(value))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

const TARGET_SHARE = 0.9;

/** Derivation from the lauda: max = laudas × lauda, target = 0.9 × max (min is set per size). */
function sizeSpec(id: ArticleSize, fields: Omit<ArticleSizeSpec, 'id' | 'maxChars' | 'targetChars' | 'description'> & { summary: string }): ArticleSizeSpec {
  const maxChars = fields.laudas * CHARS_PER_LAUDA;
  const { summary, ...rest } = fields;
  return { id, ...rest, maxChars, targetChars: Math.round(maxChars * TARGET_SHARE), description: `${summary} Até ${groupDigits(maxChars)} caracteres.` };
}

export const ARTICLE_SIZES: Readonly<Record<ArticleSize, ArticleSizeSpec>> = {
  short: sizeSpec('short', {
    label: 'Curto',
    laudas: 1,
    minChars: CHARS_PER_LAUDA / 2,
    sections: { min: 1, max: 3, default: 2 },
    headings: false,
    introShare: 0.4,
    summary: 'Notícia direta: um fato, pouco contexto.',
  }),
  standard: sizeSpec('standard', {
    label: 'Padrão',
    laudas: 2,
    minChars: CHARS_PER_LAUDA + 1,
    sections: { min: 2, max: 5, default: 3 },
    headings: true,
    introShare: 0.25,
    summary: 'Notícia com contexto: histórico, citações, fontes e links.',
  }),
};

/** The size field's rule, in the writer's words. */
export const SIZE_RULE = `1 lauda = ${groupDigits(CHARS_PER_LAUDA)} caracteres com espaços. A IA não completa o texto para chegar ao tamanho.`;

export function isArticleSize(value: unknown): value is ArticleSize {
  return typeof value === 'string' && (ARTICLE_SIZE_IDS as readonly string[]).includes(value);
}

/** The spec of a size (an unknown value from old data reads as the default size). */
export function sizeOf(size: ArticleSize): ArticleSizeSpec {
  return isArticleSize(size) ? ARTICLE_SIZES[size] : ARTICLE_SIZES[DEFAULT_ARTICLE_SIZE];
}

/** "lauda" below 2, "laudas" from 2 ("1,4 lauda", "2 laudas"). */
export function laudaUnit(value: number): string {
  return value >= 2 ? 'laudas' : 'lauda';
}

/** Laudas of a text, rounded UP to one decimal (a started line counts): 2.001 characters = 1,1. */
export function laudas(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil((Math.round(chars) * 10) / CHARS_PER_LAUDA) / 10;
}

/** "1,4", "2", "0,4": a lauda count with a decimal comma. */
export function laudaNumber(value: number): string {
  const tenths = Math.round(value * 10);
  return tenths % 10 === 0 ? String(tenths / 10) : `${Math.floor(tenths / 10)},${tenths % 10}`;
}

/**
 * Laudas of a text, rounded UP to one decimal, plural only from 2: "0,4 lauda", "1 lauda",
 * "1,4 lauda", "2 laudas", "2,3 laudas".
 */
export function formatLaudas(chars: number): string {
  const value = laudas(chars);
  return `${laudaNumber(value)} ${laudaUnit(value)}`;
}

/** A text against its size: "1,4 de 2 laudas", "0,8 de 1 lauda" (the unit follows the size). */
export function formatLaudasOf(chars: number, size: ArticleSize): string {
  const spec = sizeOf(size);
  return `${laudaNumber(laudas(chars))} de ${spec.laudas} ${laudaUnit(spec.laudas)}`;
}

/** "2.764 caracteres", "1 caractere": the lauda count of a text (characters with spaces). */
export function formatCharacters(chars: number): string {
  return `${groupDigits(chars)} ${Math.round(chars) === 1 ? 'caractere' : 'caracteres'}`;
}

/** Characters past the size's maximum ("640 caracteres acima"); 0 inside the size. */
export function charactersAbove(chars: number, size: ArticleSize): number {
  return Math.max(0, Math.round(chars) - sizeOf(size).maxChars);
}

/** "Curto · 1 lauda", "Padrão · 2 laudas". */
export function sizeLabel(size: ArticleSize): string {
  const spec = sizeOf(size);
  return `${spec.label} · ${spec.laudas} ${laudaUnit(spec.laudas)}`;
}

/** "Encurtar para 2 laudas": the action when a text passes its size. */
export function shortenToSizeLabel(size: ArticleSize): string {
  const spec = sizeOf(size);
  return `Encurtar para ${spec.laudas} ${laudaUnit(spec.laudas)}`;
}

/** "1,4/2 laudas", "0,8/1 lauda": the check's short value. */
export function sizeMeta(chars: number, size: ArticleSize): string {
  const spec = sizeOf(size);
  return `${laudaNumber(laudas(chars))}/${spec.laudas} ${laudaUnit(spec.laudas)}`;
}

export type SizeFit = 'below' | 'inside' | 'above';

/** Where a character count lands against the size's range. */
export function sizeFit(size: ArticleSize, chars: number): SizeFit {
  const spec = sizeOf(size);
  if (chars > spec.maxChars) return 'above';
  return chars < spec.minChars ? 'below' : 'inside';
}

/** A section count inside the size's range (switching Padrão → Curto with 5 sections gives 3). */
export function fitSections(size: ArticleSize, sections: number): number {
  const { min, max } = sizeOf(size).sections;
  return Math.min(max, Math.max(min, Math.round(sections)));
}

export type SectionBudget = { introChars: number; sectionChars: number };

/** Characters per part of a draft: the introduction's share of the target, the rest split per section. */
export function sectionBudget(size: ArticleSize, sections: number): SectionBudget {
  const spec = sizeOf(size);
  const introChars = Math.round(spec.targetChars * spec.introShare);
  const count = Math.max(1, Math.round(sections));
  return { introChars, sectionChars: Math.floor((spec.targetChars - introChars) / count) };
}

export type ExpectedDraft = {
  /** Characters the draft will have: the target, or everything the material gives. */
  chars: number;
  /** The material reaches the target (within the tolerance). */
  reachesTarget: boolean;
  /** The draft lands inside the size's range (false: the material does not fill this size). */
  reachesRange: boolean;
};

/**
 * What a draft of this size will have, given the longest draft the material supports: the
 * target when the material reaches it (within the tolerance), else everything the material
 * gives. Never more than the material, never above the size's maximum.
 */
export function expectedDraftChars(size: ArticleSize, charsAvailable: number): ExpectedDraft {
  const spec = sizeOf(size);
  const available = Math.max(0, Math.round(charsAvailable));
  const reachesTarget = available >= spec.targetChars * (1 - SIZE_TOLERANCE);
  const chars = reachesTarget ? spec.targetChars : Math.min(available, spec.maxChars);
  return { chars, reachesTarget, reachesRange: chars >= spec.minChars };
}
