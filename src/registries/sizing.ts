import { CHARS_PER_LAUDA, DEFAULT_ARTICLE_SIZE, FORMAT_SPECS, formatSizeOf, groupDigits, sectionBudget, sizeOf, SIZE_TOLERANCE } from '../domain/index.ts';
import type { ArticleSize, Brief, FlowId } from '../domain/index.ts';
import type { DraftSizeInstructions } from '../ports/index.ts';
import { sectionStepId } from './recipes.ts';
import { R1_ARTICLE_LIMITS } from '../domain/article-policy.ts';
import type { ReleaseId } from './release.ts';

/**
 * How each kind of article is sized, as data tied to the flows. Hard News (R1 transcript →
 * article, R2 news → article) is sized in laudas: Curto or Padrão, chosen in the pauta. Evergreen
 * (R3 opportunity → article) follows search intent, the approved outline and the SERP instead:
 * no lauda cap, sections from the approved outline, and "Tamanho" is only information there.
 * Both never pad: the material decides how far a text goes.
 */

export type LaudaSizingPolicy = {
  id: 'hard-news';
  kind: 'laudas';
  since: ReleaseId;
  flows: FlowId[];
  charsPerLauda: number;
  sizes: readonly ArticleSize[];
  defaultSize: ArticleSize;
  neverPad: true;
  /** What a provider adapter tells the model; `{max}` is the size's maximum ("4.000"). */
  instruction: string;
};

export type IntentSizingPolicy = {
  id: 'evergreen';
  kind: 'intent';
  since: ReleaseId;
  flows: FlowId[];
  /** What sets the size: search intent, the approved outline and the SERP (a reference, not a goal). */
  basis: readonly ('search-intent' | 'outline' | 'serp')[];
  /** No lauda cap. */
  cap: null;
  sections: 'from-approved-outline';
  neverPad: true;
  /** "Tamanho" shows laudas and characters as information only. */
  check: 'info';
};

export type SizingPolicy = LaudaSizingPolicy | IntentSizingPolicy;

export const HARD_NEWS_SIZING: LaudaSizingPolicy = {
  id: 'hard-news',
  kind: 'laudas',
  since: 'R1',
  flows: ['transcript-article', 'news-article'],
  charsPerLauda: CHARS_PER_LAUDA,
  sizes: [DEFAULT_ARTICLE_SIZE],
  defaultSize: DEFAULT_ARTICLE_SIZE,
  neverPad: true,
  instruction: 'O corpo deve cumprir simultaneamente 2.500–4.000 caracteres com espaços e 500–800 palavras. Busque 3.900 caracteres e cerca de 700 palavras, sem ultrapassar nenhum teto. Inclua ao menos duas citações literais distintas, copiadas da evidência referenciada. Se faltar material, sinalize a insuficiência; nunca preencha com repetição ou invenção.',
};

export const EVERGREEN_SIZING: IntentSizingPolicy = {
  id: 'evergreen',
  kind: 'intent',
  since: 'R3',
  flows: ['opportunity-article'],
  basis: ['search-intent', 'outline', 'serp'],
  cap: null,
  sections: 'from-approved-outline',
  neverPad: true,
  check: 'info',
};

export const SIZING_POLICIES: readonly SizingPolicy[] = [HARD_NEWS_SIZING, EVERGREEN_SIZING];

/** The sizing policy of a flow (Hard News for the R1 flow and for flows without one). */
export function sizingPolicyFor(flowId: FlowId): SizingPolicy {
  return SIZING_POLICIES.find((policy) => policy.flows.includes(flowId)) ?? HARD_NEWS_SIZING;
}

/** The size contract of a brief (Hard News): numbers, budgets per section and the model's sentence. */
export function draftSizeInstructions(brief: Pick<Brief, 'size' | 'sections' | 'format' | 'formatSize'>): DraftSizeInstructions {
  if (brief.format) return formatSizeInstructions(brief as Pick<Brief, 'size' | 'sections' | 'formatSize'> & { format: NonNullable<Brief['format']> });
  const spec = sizeOf(brief.size);
  const budget = sectionBudget(spec.id, brief.sections);
  return {
    size: spec.id,
    laudas: spec.laudas,
    charsPerLauda: CHARS_PER_LAUDA,
    minChars: spec.minChars,
    maxChars: spec.maxChars,
    targetChars: spec.targetChars,
    ...(spec.id === 'standard' ? { minWords: R1_ARTICLE_LIMITS.minWords, maxWords: R1_ARTICLE_LIMITS.maxWords,
      targetWords: R1_ARTICLE_LIMITS.targetWords, minQuotes: R1_ARTICLE_LIMITS.minQuotes } : {}),
    tolerance: SIZE_TOLERANCE,
    headings: spec.headings,
    neverPad: true,
    introChars: budget.introChars,
    sections: Array.from({ length: Math.max(0, brief.sections) }, (_, index) => ({ stepId: sectionStepId(index + 1), budgetChars: budget.sectionChars })),
    instruction: spec.id === 'standard' ? HARD_NEWS_SIZING.instruction
      : `Escreva até ${groupDigits(spec.maxChars)} caracteres; se o material não sustentar, escreva menos e não complete.`,
  };
}

/**
 * The size contract of an event format (formats.ts): its option's range and target, the format's
 * minimum of literal quotes and its intertítulos rule. Characters only: the outlet sizes these
 * texts by characters, and the words of a short note say nothing a character count does not.
 */
function formatSizeInstructions(brief: Pick<Brief, 'size' | 'sections' | 'formatSize'> & { format: NonNullable<Brief['format']> }): DraftSizeInstructions {
  const spec = FORMAT_SPECS[brief.format], option = formatSizeOf(brief.format, brief.formatSize);
  const count = Math.max(1, Math.round(brief.sections));
  const introChars = Math.round(option.targetChars * spec.introShare);
  const budgetChars = Math.floor((option.targetChars - introChars) / count);
  return {
    size: brief.size,
    laudas: Math.ceil(option.maxChars / CHARS_PER_LAUDA),
    charsPerLauda: CHARS_PER_LAUDA,
    minChars: option.minChars,
    maxChars: option.maxChars,
    targetChars: option.targetChars,
    minQuotes: spec.minQuotes,
    tolerance: SIZE_TOLERANCE,
    headings: spec.headings,
    neverPad: true,
    introChars,
    sections: Array.from({ length: count }, (_, index) => ({ stepId: sectionStepId(index + 1), budgetChars })),
    instruction: `${spec.label}: escreva entre ${groupDigits(option.minChars)} e ${groupDigits(option.maxChars)} caracteres, perto de ${groupDigits(option.targetChars)}${spec.minQuotes ? `, com ao menos ${spec.minQuotes} citações literais` : ''}. Se o material não sustentar, escreva menos e não complete.`,
  };
}
