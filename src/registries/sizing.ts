import { ARTICLE_SIZE_IDS, CHARS_PER_LAUDA, DEFAULT_ARTICLE_SIZE, groupDigits, sectionBudget, sizeOf, SIZE_TOLERANCE } from '../domain/index.ts';
import type { ArticleSize, Brief, FlowId } from '../domain/index.ts';
import type { DraftSizeInstructions } from '../ports/index.ts';
import { sectionStepId } from './recipes.ts';
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
  sizes: ARTICLE_SIZE_IDS,
  defaultSize: DEFAULT_ARTICLE_SIZE,
  neverPad: true,
  instruction: 'Escreva até {max} caracteres; se o material não sustentar, escreva menos e não complete.',
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
export function draftSizeInstructions(brief: Pick<Brief, 'size' | 'sections'>): DraftSizeInstructions {
  const spec = sizeOf(brief.size);
  const budget = sectionBudget(spec.id, brief.sections);
  return {
    size: spec.id,
    laudas: spec.laudas,
    charsPerLauda: CHARS_PER_LAUDA,
    minChars: spec.minChars,
    maxChars: spec.maxChars,
    targetChars: spec.targetChars,
    tolerance: SIZE_TOLERANCE,
    headings: spec.headings,
    neverPad: true,
    introChars: budget.introChars,
    sections: Array.from({ length: Math.max(0, brief.sections) }, (_, index) => ({ stepId: sectionStepId(index + 1), budgetChars: budget.sectionChars })),
    instruction: HARD_NEWS_SIZING.instruction.replace('{max}', groupDigits(spec.maxChars)),
  };
}
