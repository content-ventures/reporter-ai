import { refKey, sizeOf } from '../../domain/index.ts';
import type { ArticleSize, BlockId, OutlineProposal, RunId, SourceRef } from '../../domain/index.ts';
import type { OutlineInput } from '../../ports/index.ts';

/**
 * Nova produção, step 3 "Estrutura" (D6, CONTRACT §3.9): the outline the AI proposed, as the
 * person edits it before "Redigir artigo" — the probable title, the introduction's quotes and the
 * sections in order, each with its intertítulo (a Curto has parts without intertítulos) and the
 * lines of the interview it is written from. Sections can be renamed, reordered, removed and
 * added; a quote belongs to one place only. Pure: the screen keeps the value, the generation
 * port receives `toOutlineInput`.
 */

export type OutlinePlace = 'intro' | string;

export type OutlineSectionDraft = {
  /** Stable key on screen (the proposal's block id, or `new-N` for a section the person added). */
  key: string;
  blockId?: BlockId;
  title: string;
  quotes: SourceRef[];
};

export type OutlineDraft = {
  /** The outline run the proposal came from (provenance of the draft). */
  runId?: RunId;
  size: ArticleSize;
  title: string;
  intro: SourceRef[];
  sections: OutlineSectionDraft[];
  /** Characters of the introduction ("Introdução · ≈ 0,4 lauda"). */
  introBudget: number;
  /** Characters the proposal gave the sections in all; shared when the count changes. */
  sectionsBudget: number;
  /** Budget of each proposed section (by key), while the person keeps the proposed count. */
  proposedBudgets: Readonly<Record<string, number>>;
  /** Every quote the structure may hold: the proposal's own and the other quotable lines. */
  pool: SourceRef[];
  /** Next number for an added section's key. */
  added: number;
};

export function outlineFromProposal(proposal: OutlineProposal, size: ArticleSize, runId?: RunId): OutlineDraft {
  const sections = proposal.sections.map((section, index) => ({
    key: section.blockId ?? `proposed-${index + 1}`,
    ...(section.blockId ? { blockId: section.blockId } : {}),
    title: section.title,
    quotes: [...(section.quotes ?? [])],
  }));
  const proposedBudgets: Record<string, number> = {};
  let sectionsBudget = 0;
  proposal.sections.forEach((section, index) => {
    const budget = section.budget ?? 0;
    proposedBudgets[sections[index].key] = budget;
    sectionsBudget += budget;
  });
  const seen = new Set<string>();
  const pool: SourceRef[] = [];
  for (const ref of [...proposal.intro.quotes, ...sections.flatMap((section) => section.quotes), ...proposal.candidates]) {
    const key = refKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    pool.push(ref);
  }
  return {
    ...(runId ? { runId } : {}),
    size,
    title: proposal.title,
    intro: [...proposal.intro.quotes],
    sections,
    introBudget: proposal.intro.budget,
    sectionsBudget,
    proposedBudgets,
    pool,
    added: 0,
  };
}

/** "Parte 2": a Curto's part (no intertítulo, CONTRACT §3.9). */
export function partTitle(index: number): string {
  return `Parte ${index + 1}`;
}

/** Whether this size writes intertítulos (Padrão) or only parts (Curto). */
export function hasHeadings(draft: Pick<OutlineDraft, 'size'>): boolean {
  return sizeOf(draft.size).headings;
}

// ── Edits ────────────────────────────────────────────────────────────────────────────────

export function renameSection(draft: OutlineDraft, key: string, title: string): OutlineDraft {
  return { ...draft, sections: draft.sections.map((section) => (section.key === key ? { ...section, title } : section)) };
}

/** Moves a section between positions of the section list (the introduction is not one of them). */
export function moveSection(draft: OutlineDraft, from: number, to: number): OutlineDraft {
  const last = draft.sections.length - 1;
  const source = Math.min(Math.max(from, 0), last);
  const target = Math.min(Math.max(to, 0), last);
  if (source === target) return draft;
  const sections = [...draft.sections];
  const [moved] = sections.splice(source, 1);
  if (moved) sections.splice(target, 0, moved);
  return { ...draft, sections };
}

/** Takes a section out; its quotes go back to "Citações da entrevista". */
export function removeSection(draft: OutlineDraft, key: string): OutlineDraft {
  if (!sectionLimits(draft).canRemove) return draft;
  return { ...draft, sections: draft.sections.filter((section) => section.key !== key) };
}

/** A new empty section at the end ("+ Seção"): the person writes its intertítulo and picks its quotes. */
export function addSection(draft: OutlineDraft): { draft: OutlineDraft; key?: string } {
  if (!sectionLimits(draft).canAdd) return { draft };
  const key = `new-${draft.added + 1}`;
  return { draft: { ...draft, added: draft.added + 1, sections: [...draft.sections, { key, title: '', quotes: [] }] }, key };
}

const placeQuotes = (draft: OutlineDraft, place: OutlinePlace): SourceRef[] =>
  place === 'intro' ? draft.intro : (draft.sections.find((section) => section.key === place)?.quotes ?? []);

function withQuotes(draft: OutlineDraft, place: OutlinePlace, quotes: SourceRef[]): OutlineDraft {
  if (place === 'intro') return { ...draft, intro: quotes };
  return { ...draft, sections: draft.sections.map((section) => (section.key === place ? { ...section, quotes } : section)) };
}

/** Adds a quote to the introduction or a section; a quote already placed elsewhere is not added twice. */
export function addQuote(draft: OutlineDraft, place: OutlinePlace, ref: SourceRef): OutlineDraft {
  if (usedQuoteKeys(draft).has(refKey(ref))) return draft;
  return withQuotes(draft, place, [...placeQuotes(draft, place), ref]);
}

export function removeQuote(draft: OutlineDraft, place: OutlinePlace, ref: SourceRef): OutlineDraft {
  const key = refKey(ref);
  return withQuotes(draft, place, placeQuotes(draft, place).filter((quote) => refKey(quote) !== key));
}

// ── Reading ──────────────────────────────────────────────────────────────────────────────

export function usedQuoteKeys(draft: Pick<OutlineDraft, 'intro' | 'sections'>): Set<string> {
  return new Set([...draft.intro, ...draft.sections.flatMap((section) => section.quotes)].map(refKey));
}

/** "Citações da entrevista": the quotable lines not used anywhere in the structure, in material order. */
export function availableQuotes(draft: OutlineDraft): SourceRef[] {
  const used = usedQuoteKeys(draft);
  return draft.pool.filter((ref) => !used.has(refKey(ref)));
}

/**
 * Characters a section is written to ("≈ 0,5 lauda"): its proposed budget while the person keeps
 * the proposed sections; otherwise the proposal's section total shared by the sections there are
 * (an honest shortfall stays a shortfall).
 */
export function sectionBudgetAt(draft: OutlineDraft, index: number): number {
  const keys = Object.keys(draft.proposedBudgets);
  const proposed = draft.sections.length === keys.length && draft.sections.every((section) => section.key in draft.proposedBudgets);
  const section = draft.sections[index];
  if (proposed && section) return draft.proposedBudgets[section.key] ?? 0;
  return draft.sections.length > 0 ? Math.floor(draft.sectionsBudget / draft.sections.length) : 0;
}

export type SectionLimits = { canAdd: boolean; addReason?: string; canRemove: boolean; removeReason?: string };

/** "Padrão aceita até 5 seções." · "Curto precisa de pelo menos 1 parte." (COPY §6.4). */
function countReasons(size: ArticleSize): { above: string; below: string } {
  const spec = sizeOf(size);
  const { min, max } = spec.sections;
  const unit = (count: number) => (spec.headings ? (count === 1 ? 'seção' : 'seções') : count === 1 ? 'parte' : 'partes');
  return {
    above: `${spec.label} aceita até ${max} ${unit(max)}.`,
    below: `${spec.label} precisa de pelo menos ${min} ${unit(min)}.`,
  };
}

/** "+ Seção" and "Tirar seção" stay where the size allows, with the visible reason (COPY §6.4). */
export function sectionLimits(draft: Pick<OutlineDraft, 'size' | 'sections'>): SectionLimits {
  const { min, max } = sizeOf(draft.size).sections;
  const count = draft.sections.length;
  const reasons = countReasons(draft.size);
  const limits: SectionLimits = { canAdd: count < max, canRemove: count > min };
  if (!limits.canAdd) limits.addReason = reasons.above;
  if (!limits.canRemove) limits.removeReason = reasons.below;
  return limits;
}

/** Why "Redigir artigo" cannot run yet (the visible reason), in screen order; `undefined` when it can. */
export function outlineBlocker(draft: OutlineDraft): string | undefined {
  const spec = sizeOf(draft.size);
  const { min, max } = spec.sections;
  if (draft.sections.length > max) return countReasons(draft.size).above;
  if (draft.sections.length < min) return countReasons(draft.size).below;
  if (spec.headings && draft.sections.some((section) => !section.title.trim())) return 'Escreva o intertítulo.';
  if (draft.sections.some((section) => section.quotes.length === 0)) return 'Cada seção precisa de pelo menos uma citação.';
  return undefined;
}

/** The section whose problem `outlineBlocker` names (focus target), if any. */
export function blockingSectionKey(draft: OutlineDraft): string | undefined {
  if (hasHeadings(draft)) {
    const untitled = draft.sections.find((section) => !section.title.trim());
    if (untitled) return untitled.key;
  }
  return draft.sections.find((section) => section.quotes.length === 0)?.key;
}

/** The reviewed structure as the draft run takes it (`start('article.draft', { outline })`). */
export function toOutlineInput(draft: OutlineDraft): OutlineInput {
  const headings = hasHeadings(draft);
  return {
    title: draft.title.trim(),
    intro: { quotes: draft.intro.map((ref) => structuredClone(ref)) },
    sections: draft.sections.map((section) => ({
      ...(section.blockId ? { blockId: section.blockId } : {}),
      // A Curto writes no intertítulo: an added part leaves it empty ("Parte k" on the adapter side).
      title: headings ? section.title.trim() : section.blockId ? section.title : '',
      quotes: section.quotes.map((ref) => structuredClone(ref)),
    })),
    ...(draft.runId ? { fromRunId: draft.runId } : {}),
  };
}
