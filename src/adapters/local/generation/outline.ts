import type { ImageSlot } from '../../../domain/article.ts';
import { refKey } from '../../../domain/refs.ts';
import type { SourceRef } from '../../../domain/refs.ts';
import { ok, refuse } from '../../../domain/result.ts';
import type { Result } from '../../../domain/result.ts';
import type { OutlineEdited, OutlineIntro, OutlineSection, OutlineShortfall, OutlineSize, RunEventPayload, RunFold } from '../../../domain/run-events.ts';
import { formatLaudas, laudaUnit, sizeOf } from '../../../domain/sizing.ts';
import type { ArticleSize } from '../../../domain/sizing.ts';
import { contentHash } from '../../../domain/text/hash.ts';
import type { OutlineInput } from '../../../ports/generation.ts';
import { draftSizeInstructions } from '../../../registries/sizing.ts';
import { answerSentence, planChars } from './draft-plan.ts';
import type { DraftPlan, PlannedOutline } from './draft-plan.ts';
import type { Material } from './material.ts';

/**
 * The structure of an article ("Montando estrutura"): what the outline event announces for a
 * plan (sections with their character budget and quotes, the size from `draftSizeInstructions`,
 * the shortfall when the material cannot fill it), and the checks a structure a person edited
 * passes before it is written ("Redigir artigo").
 */

export type OutlinePayload = Extract<RunEventPayload, { type: 'outline' }>;

/** Longest intertítulo a structure accepts. */
export const MAX_SECTION_TITLE = 120;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "seção"/"seções" in a Padrão, "parte"/"partes" in a Curto (a Curto has no intertítulos). */
function sectionWord(size: ArticleSize, count: number): string {
  return sizeOf(size).headings ? plural(count, 'seção', 'seções') : plural(count, 'parte', 'partes');
}

export type OutlineContext = {
  size: ArticleSize;
  /** Characters of the longest text the material supports. */
  materialChars: number;
  cover?: ImageSlot;
  edited?: OutlineEdited;
};

/**
 * The outline event of a plan. Budgets follow the size's contract (`draftSizeInstructions`) for
 * the plan's number of sections; when the plan cannot reach the target (the material gives less)
 * the shortfall says how far it goes and the budgets shrink in proportion, so the structure never
 * promises text the material does not hold.
 */
export function outlineEvent(plan: DraftPlan, context: OutlineContext): OutlinePayload {
  const sizing = draftSizeInstructions({ size: context.size, sections: Math.max(1, plan.sections.length) });
  const chars = planChars(plan);
  const short = chars < sizing.targetChars * (1 - sizing.tolerance);
  const scale = short ? chars / sizing.targetChars : 1;
  const budget = (value: number) => Math.round(value * scale);
  const size: OutlineSize = { laudas: sizing.laudas, minChars: sizing.minChars, maxChars: sizing.maxChars, targetChars: sizing.targetChars };
  const intro: OutlineIntro = { budget: budget(sizing.introChars), quotes: plan.introQuotes.map((ref) => structuredClone(ref)) };
  const sections: OutlineSection[] = plan.sections.map((section, index) => ({
    blockId: section.blockId,
    title: section.title,
    budget: budget(sizing.sections[index]?.budgetChars ?? sizing.sections[sizing.sections.length - 1]?.budgetChars ?? 0),
    quotes: section.quotes.map((ref) => structuredClone(ref)),
  }));
  const payload: OutlinePayload = {
    type: 'outline',
    title: plan.title,
    sections,
    intro,
    size,
    materialChars: context.materialChars,
    candidates: plan.candidates.map((ref) => structuredClone(ref)),
  };
  if (short) payload.shortfall = { reason: 'material', expectedChars: chars } satisfies OutlineShortfall;
  if (context.cover) payload.cover = context.cover;
  if (context.edited) payload.edited = context.edited;
  return payload;
}

/** "3 seções · alvo 2 laudas", or "2 partes · o material rende ≈ 0,8 lauda" when it gives less. */
export function outlineMeta(payload: OutlinePayload, size: ArticleSize): string {
  const count = sectionWord(size, payload.sections.length);
  if (payload.shortfall) return `${count} · o material rende ≈ ${formatLaudas(payload.shortfall.expectedChars)}`;
  const laudas = payload.size?.laudas ?? sizeOf(size).laudas;
  return `${count} · alvo ${laudas} ${laudaUnit(laudas)}`;
}

// ——— A structure a person edited ———

/** Why a structure cannot be written, in the words of Nova produção (COPY §6.4). */
function countRefusal(size: ArticleSize, count: number): string | undefined {
  const spec = sizeOf(size);
  const { min, max } = spec.sections;
  if (spec.headings) {
    if (count > max) return `${spec.label} aceita até ${max} seções.`;
    if (count < min) return `${spec.label} precisa de pelo menos ${plural(min, 'seção', 'seções')}.`;
  } else {
    if (count > max) return `${spec.label} aceita até ${max} partes.`;
    if (count < min) return `${spec.label} precisa de pelo menos ${plural(min, 'parte', 'partes')}.`;
  }
  return undefined;
}

export const OUTLINE_MESSAGES = {
  heading: 'Escreva o intertítulo.',
  headingTooLong: `Intertítulo com até ${MAX_SECTION_TITLE} caracteres.`,
  quoteTwice: 'Cada citação entra em uma seção só.',
  quoteUnknown: 'Esta citação não está na entrevista.',
  sectionWithoutQuote: 'Cada seção precisa de pelo menos uma citação.',
} as const;

export type NormalizeContext = {
  size: ArticleSize;
  material: Material;
  /** The article's title when the person left it empty (the headline of the material). */
  defaultTitle: () => string;
};

/**
 * Checks and settles a structure before it is written: the section count fits the size, every
 * intertítulo has 1–120 characters (a Curto's empty part is "Parte k"), every quote is an answer of
 * the interview as it is now and appears once, and every section has a quote. A section the
 * person added gets a stable id (derived from the structure, so the same structure plans the
 * same draft again after a reload).
 */
export function normalizeOutline(outline: OutlineInput, context: NormalizeContext): Result<PlannedOutline, 'invalid_outline'> {
  const invalid = (message: string) => refuse('invalid_outline' as const, message);
  const sections = Array.isArray(outline.sections) ? outline.sections : [];
  const counted = countRefusal(context.size, sections.length);
  if (counted) return invalid(counted);
  const headings = sizeOf(context.size).headings;
  const seen = new Set<string>();
  const check = (refs: readonly SourceRef[] | undefined): string | undefined => {
    for (const ref of refs ?? []) {
      const sentence = answerSentence(context.material, ref);
      if (!sentence) return OUTLINE_MESSAGES.quoteUnknown;
      const keys = [refKey(ref), `${sentence.line.segmentId}:${sentence.from}`];
      if (keys.some((key) => seen.has(key))) return OUTLINE_MESSAGES.quoteTwice;
      for (const key of keys) seen.add(key);
    }
    return undefined;
  };
  const introProblem = check(outline.intro?.quotes);
  if (introProblem) return invalid(introProblem);
  const titles: string[] = [];
  for (const [index, section] of sections.entries()) {
    const title = typeof section?.title === 'string' ? section.title.trim().replace(/\s+/g, ' ') : '';
    if (!title && headings) return invalid(OUTLINE_MESSAGES.heading);
    if (title.length > MAX_SECTION_TITLE) return invalid(OUTLINE_MESSAGES.headingTooLong);
    titles.push(title || `Parte ${index + 1}`);
    if (!section?.quotes || section.quotes.length === 0) return invalid(OUTLINE_MESSAGES.sectionWithoutQuote);
    const problem = check(section.quotes);
    if (problem) return invalid(problem);
  }
  // Added sections (and a repeated id) get ids from what the structure says, never from a counter.
  const tag = contentHash({ titles, quotes: sections.map((section) => section.quotes.map(refKey)) }).slice(0, 8);
  const ids = new Set<string>();
  const planned: PlannedOutline = {
    title: (typeof outline.title === 'string' ? outline.title.trim().replace(/\s+/g, ' ') : '') || context.defaultTitle(),
    intro: (outline.intro?.quotes ?? []).map((ref) => structuredClone(ref)),
    sections: sections.map((section, index) => {
      const given = typeof section.blockId === 'string' && section.blockId && !ids.has(section.blockId) ? section.blockId : undefined;
      const blockId = given ?? `blk-out-${tag}-${index + 1}`;
      ids.add(blockId);
      return { blockId, title: titles[index], quotes: section.quotes.map((ref) => structuredClone(ref)) };
    }),
  };
  return ok(planned);
}

/** Stable key of a settled structure (what its draft is planned from). */
export function outlineKey(outline: PlannedOutline): string {
  return contentHash({
    title: outline.title,
    intro: outline.intro.map(refKey),
    sections: outline.sections.map((section) => ({ id: section.blockId, title: section.title, quotes: section.quotes.map(refKey) })),
  });
}

/** True when a structure is exactly the one a plan proposes (a script keeps its hand-written text then). */
export function sameOutline(plan: DraftPlan, outline: PlannedOutline): boolean {
  const keys = (refs: readonly SourceRef[]) => refs.map(refKey).join('|');
  return (
    plan.title === outline.title &&
    keys(plan.introQuotes) === keys(outline.intro) &&
    plan.sections.length === outline.sections.length &&
    plan.sections.every((section, index) => {
      const other = outline.sections[index];
      return section.blockId === other.blockId && section.title === other.title && keys(section.quotes) === keys(other.quotes);
    })
  );
}

/**
 * The structure a draft run followed, read back from its outline (a run of an earlier session):
 * planning it again gives the same draft, so "Tentar de novo" continues it after a reload.
 */
export function outlineInputOf(fold: RunFold): OutlineInput | undefined {
  if (!fold.edited) return undefined;
  const input: OutlineInput = {
    title: fold.title ?? '',
    intro: { quotes: (fold.intro?.quotes ?? []).map((ref) => structuredClone(ref)) },
    sections: fold.outline.map((section) => ({
      ...(section.blockId ? { blockId: section.blockId } : {}),
      title: section.title,
      quotes: (section.quotes ?? []).map((ref) => structuredClone(ref)),
    })),
  };
  if (fold.edited.fromRunId) input.fromRunId = fold.edited.fromRunId;
  return input;
}
