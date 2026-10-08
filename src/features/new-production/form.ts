import { DEFAULT_ARTICLE_SIZE, expectedDraftChars, fitSections, foldForMatch, formatLaudas, sizeLabel, sizeOf } from '../../domain/index.ts';
import type { ArticleSize, PieceKind, SourceOrigin } from '../../domain/index.ts';
import type { NewProductionInput, SourceAnalysis, SpeakerAssignment } from '../../ports/index.ts';

/**
 * Nova produção as a pure form model (CONTRACT §3.9, D6): three short steps with one decision
 * each — Material (the transcript, who speaks, the speakers' consent) → Pauta (size, sections,
 * angle, pieces, internal title) → Estrutura (the outline the AI proposes, edited before
 * drafting). The draft the screen edits, what blocks each step's primary (the visible reason),
 * the field validation behind ErrorSummary, and the command input. No React, no clock.
 */

export type MaterialMode = 'paste' | 'file';

/** "Entregas": the article is mandatory; the carousel is the optional derivative. */
export type DeliveryPlan = 'article' | 'article-carousel';

/** The three steps, in order. */
export type NewProductionStep = 'material' | 'brief' | 'structure';

export const NEW_PRODUCTION_STEPS: readonly NewProductionStep[] = ['material', 'brief', 'structure'];

export const STEP_LABELS: Readonly<Record<NewProductionStep, string>> = {
  material: 'Material',
  brief: 'Pauta',
  structure: 'Estrutura',
};

/**
 * "Falantes": a detected label linked to a workspace person, a new person (name, role and
 * organisation), explicitly nobody ("Sem atribuição"), or still undecided (`unset`).
 */
export type SpeakerChoice =
  | { kind: 'unset' }
  | { kind: 'none' }
  | { kind: 'person'; personId: string }
  | { kind: 'new'; name: string; title?: string; organization?: string };

export type MaterialFile = { name: string; size: number; text: string };

export type NewProductionDraft = {
  mode: MaterialMode;
  pasted: string;
  file: MaterialFile | null;
  /** "Os falantes autorizaram o uso" (required to continue). */
  authorized: boolean;
  /** Explicit choices only; labels without one use `suggestSpeaker`. */
  speakers: Readonly<Record<string, SpeakerChoice>>;
  size: ArticleSize;
  sections: number;
  /** The person chose the number of sections in "Avançado"; otherwise it follows the size. */
  sectionsCustom: boolean;
  angle: string;
  plan: DeliveryPlan;
  title: string;
  origin: SourceOrigin;
  /** YYYY-MM-DD or empty. */
  recordedOn: string;
};

export type PersonOption = { id: string; name: string };

export const EMPTY_DRAFT: NewProductionDraft = {
  mode: 'paste',
  pasted: '',
  file: null,
  authorized: false,
  speakers: {},
  size: DEFAULT_ARTICLE_SIZE,
  sections: sizeOf(DEFAULT_ARTICLE_SIZE).sections.default,
  sectionsCustom: false,
  angle: '',
  plan: 'article-carousel',
  title: '',
  origin: 'interview',
  recordedOn: '',
};

export const MAX_TITLE_LENGTH = 120;
export const MAX_ANGLE_LENGTH = 600;

// ── Material ─────────────────────────────────────────────────────────────────────────────

/** The material the active mode points at (switching modes keeps both). */
export function draftMaterial(draft: NewProductionDraft): { text: string; fileName?: string } {
  if (draft.mode === 'file') return draft.file ? { text: draft.file.text, fileName: draft.file.name } : { text: '' };
  return { text: draft.pasted };
}

export function hasMaterial(draft: NewProductionDraft): boolean {
  return draftMaterial(draft).text.trim().length > 0;
}

/** Anything typed or chosen that leaving the page would lose. */
export function isDraftDirty(draft: NewProductionDraft): boolean {
  return (
    hasMaterial(draft) ||
    draft.title.trim() !== '' ||
    draft.angle.trim() !== '' ||
    draft.recordedOn !== '' ||
    draft.authorized ||
    draft.origin !== EMPTY_DRAFT.origin ||
    draft.sectionsCustom ||
    draft.size !== EMPTY_DRAFT.size ||
    draft.plan !== EMPTY_DRAFT.plan ||
    Object.keys(draft.speakers).length > 0
  );
}

/** "36 falas · 2 falantes · 16:48" (the duration only when the material has timestamps). */
export function analysisLine(analysis: Pick<SourceAnalysis, 'speakers' | 'stats'>, duration?: string): string {
  const speakers = analysis.speakers.length;
  return [
    `${analysis.stats.segments} ${analysis.stats.segments === 1 ? 'fala' : 'falas'}`,
    speakers > 0 ? `${speakers} ${speakers === 1 ? 'falante' : 'falantes'}` : null,
    duration ?? null,
  ]
    .filter(Boolean)
    .join(' · ');
}

// ── Falantes ─────────────────────────────────────────────────────────────────────────────

const CONNECTORS = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);

/** Two or more capitalised words ("Lucas Ferraz", "Ana da Silva"): a person, not a role. */
function looksLikeFullName(label: string): boolean {
  const words = label.trim().split(/\s+/);
  const named = words.filter((word) => !CONNECTORS.has(word.toLocaleLowerCase('pt-BR')));
  return named.length >= 2 && named.every((word) => /^\p{Lu}/u.test(word));
}

/**
 * Default link for a speaker label: the one workspace person with that name (or that first
 * name), else a new person when the label is a full name, else undecided ("Entrevistadora",
 * "R."): the person picks who it is, or "Sem atribuição".
 */
export function suggestSpeaker(label: string, people: readonly PersonOption[]): SpeakerChoice {
  const key = foldForMatch(label);
  if (!key) return { kind: 'unset' };
  const exact = people.filter((person) => foldForMatch(person.name) === key);
  if (exact.length === 1) return { kind: 'person', personId: exact[0].id };
  if (!key.includes(' ')) {
    const byFirstName = people.filter((person) => foldForMatch(person.name).split(' ')[0] === key);
    if (byFirstName.length === 1) return { kind: 'person', personId: byFirstName[0].id };
  }
  return looksLikeFullName(label) ? { kind: 'new', name: label.trim() } : { kind: 'unset' };
}

export function speakerChoice(draft: Pick<NewProductionDraft, 'speakers'>, label: string, people: readonly PersonOption[]): SpeakerChoice {
  return draft.speakers[label] ?? suggestSpeaker(label, people);
}

/** Name of a speaker as the production will show it: the linked person, the new name, or the raw label. */
export function speakerDisplayName(choice: SpeakerChoice, label: string, people: readonly PersonOption[]): string {
  if (choice.kind === 'person') return people.find((person) => person.id === choice.personId)?.name ?? label;
  if (choice.kind === 'new') return choice.name.trim() || label;
  return label;
}

/** Labels of the material still without a person or an explicit "Sem atribuição". */
export function speakersWithoutPerson(draft: Pick<NewProductionDraft, 'speakers'>, analysis: SourceAnalysis | undefined, people: readonly PersonOption[]): string[] {
  return (analysis?.speakers ?? []).filter((speaker) => speakerChoice(draft, speaker.label, people).kind === 'unset').map((speaker) => speaker.label);
}

/** "2 falantes sem pessoa" (ErrorSummary and the Falantes group). */
export function withoutPersonLabel(count: number): string {
  return `${count} ${count === 1 ? 'falante' : 'falantes'} sem pessoa`;
}

/**
 * "Entrevista com {primeiro falante nomeado}" (COPY §6.3): the first speaker linked to a person
 * who is not one of the newsroom (the interviewee, not the interviewer), else the first named
 * one; "Nova entrevista" when nobody is named yet.
 */
export function defaultTitle(
  draft: Pick<NewProductionDraft, 'speakers'>,
  analysis: SourceAnalysis | undefined,
  people: readonly PersonOption[],
  isStaff: (personId: string) => boolean = () => false,
): string {
  const named = (analysis?.speakers ?? [])
    .map((speaker) => ({ label: speaker.label, choice: speakerChoice(draft, speaker.label, people) }))
    .filter(({ choice }) => choice.kind === 'person' || (choice.kind === 'new' && choice.name.trim() !== ''));
  const guest = named.find(({ choice }) => choice.kind !== 'person' || !isStaff(choice.personId)) ?? named[0];
  return guest ? `Entrevista com ${speakerDisplayName(guest.choice, guest.label, people)}` : 'Nova entrevista';
}

// ── Pauta ────────────────────────────────────────────────────────────────────────────────

export function planKinds(plan: DeliveryPlan): PieceKind[] {
  return plan === 'article' ? ['article'] : ['article', 'carousel'];
}

/** Section counts the size accepts (Curto 1–3, Padrão 2–5). */
export function sectionOptions(size: ArticleSize): string[] {
  const { min, max } = sizeOf(size).sections;
  return Array.from({ length: max - min + 1 }, (_, index) => String(min + index));
}

/** "3 seções" in a Padrão; a Curto has parts, not intertítulos: "2 partes". */
export function sectionsLabel(size: ArticleSize, count: number): string {
  const [one, many] = sizeOf(size).headings ? ['seção', 'seções'] : ['parte', 'partes'];
  return `${count} ${count === 1 ? one : many}`;
}

/** "Automático: introdução + 3 seções" while the count follows the size; "Introdução + 4 seções" once chosen. */
export function structureChoiceLabel(size: ArticleSize, count: number, custom: boolean): string {
  return custom ? `Introdução + ${sectionsLabel(size, count)}` : `Automático: introdução + ${sectionsLabel(size, count)}`;
}

/**
 * A new size: the automatic count follows the size's default; a chosen count is fitted into the
 * size's range, and the fit is said ("Curto aceita até 3 seções: ajustado para 3.").
 */
export function withSize(draft: Pick<NewProductionDraft, 'sections' | 'sectionsCustom'>, size: ArticleSize): { size: ArticleSize; sections: number; notice?: string } {
  const spec = sizeOf(size);
  if (!draft.sectionsCustom) return { size, sections: spec.sections.default };
  const sections = fitSections(size, draft.sections);
  if (sections === draft.sections) return { size, sections };
  const notice =
    sections < draft.sections
      ? `${spec.label} aceita até ${sectionsLabel(size, spec.sections.max)}: ajustado para ${sections}.`
      : `${spec.label} precisa de pelo menos ${sectionsLabel(size, spec.sections.min)}: ajustado para ${sections}.`;
  return { size, sections, notice };
}

/** "O material rende ≈ 1,4 lauda. O texto sai com isso." when the material cannot fill the size (never padded). */
export function shortfallSentence(size: ArticleSize, charsAvailable: number | undefined): string | undefined {
  if (charsAvailable === undefined || charsAvailable <= 0) return undefined;
  const expected = expectedDraftChars(size, charsAvailable);
  return expected.reachesRange ? undefined : `O material rende ≈ ${formatLaudas(expected.chars)}. O texto sai com isso.`;
}

/** Footer summary of the Pauta: "Padrão · 2 laudas · 3 seções · 2 falantes" ("Curto · 1 lauda · 2 partes · 2 falantes"). */
export function briefSummary(size: ArticleSize, sections: number, speakers: number): string {
  return [sizeLabel(size), sectionsLabel(size, sections), speakers > 0 ? `${speakers} ${speakers === 1 ? 'falante' : 'falantes'}` : null]
    .filter(Boolean)
    .join(' · ');
}

// ── Blockers (visible reason next to the primary) and validation ─────────────────────────

/** Why "Continuar" cannot move on from Material (COPY §6.1); `undefined` when it can. */
export function materialBlocker(draft: NewProductionDraft): string | undefined {
  if (!hasMaterial(draft)) return draft.mode === 'file' ? 'Envie o arquivo da transcrição para continuar.' : 'Cole a transcrição para continuar.';
  if (!draft.authorized) return 'Marque a autorização dos falantes para continuar.';
  return undefined;
}

/** Why "Montar estrutura" cannot run from Pauta (COPY §6.1). */
export function briefBlocker(draft: Pick<NewProductionDraft, 'title' | 'size' | 'sections'>): string | undefined {
  if (!draft.title.trim()) return 'Dê um título interno.';
  const { min, max } = sizeOf(draft.size).sections;
  if (draft.sections < min || draft.sections > max) {
    return `${sizeOf(draft.size).label} aceita de ${min} a ${max} ${sizeOf(draft.size).headings ? 'seções' : 'partes'}.`;
  }
  return undefined;
}

export type DraftField = 'material' | `speaker:${string}`;

/** `unattributed`: a speaker still without a person. */
export type DraftIssue = { field: DraftField; label: string; message: string; unattributed?: true };

export const SPEAKER_UNSET_MESSAGE = 'Escolha quem fala ou “Sem atribuição”.';

/**
 * What "Continuar" asks to fix in Material, in screen order: the material itself and every
 * speaker (a person, a named new person, or "Sem atribuição": quotes are attributed from here,
 * REQ-T.7). While the material is still being read nothing is reported for its speakers.
 */
export function validateMaterial(draft: NewProductionDraft, analysis: SourceAnalysis | undefined, people: readonly PersonOption[]): DraftIssue[] {
  const issues: DraftIssue[] = [];
  if (!hasMaterial(draft)) {
    issues.push({ field: 'material', label: 'Transcrição', message: draft.mode === 'file' ? 'Envie o arquivo da transcrição.' : 'Cole a transcrição.' });
  }
  for (const speaker of analysis?.speakers ?? []) {
    const choice = speakerChoice(draft, speaker.label, people);
    if (choice.kind === 'new' && !choice.name.trim()) {
      issues.push({ field: `speaker:${speaker.label}`, label: speaker.label, message: 'Informe o nome da pessoa.' });
    }
    if (choice.kind === 'unset') {
      issues.push({ field: `speaker:${speaker.label}`, label: speaker.label, message: SPEAKER_UNSET_MESSAGE, unattributed: true });
    }
  }
  return issues;
}

// ── Command input ────────────────────────────────────────────────────────────────────────

export function toCreateInput(draft: NewProductionDraft, analysis: SourceAnalysis | undefined, people: readonly PersonOption[]): NewProductionInput {
  const material = draftMaterial(draft);
  const speakers: SpeakerAssignment[] = [];
  for (const speaker of analysis?.speakers ?? []) {
    const choice = speakerChoice(draft, speaker.label, people);
    if (choice.kind === 'person') speakers.push({ label: speaker.label, personId: choice.personId });
    if (choice.kind === 'none') speakers.push({ label: speaker.label, unattributed: true });
    if (choice.kind === 'new' && choice.name.trim()) {
      const title = choice.title?.trim();
      const organization = choice.organization?.trim();
      speakers.push({ label: speaker.label, newPerson: { name: choice.name.trim(), ...(title ? { title } : {}), ...(organization ? { organization } : {}) } });
    }
  }
  const angle = draft.angle.trim();
  const input: NewProductionInput = {
    title: draft.title.trim(),
    material: { text: material.text, format: 'auto', origin: draft.origin, authorized: draft.authorized },
    speakers,
    brief: { sections: draft.sections, size: draft.size },
    plan: planKinds(draft.plan),
  };
  if (material.fileName) input.material.fileName = material.fileName;
  if (draft.recordedOn) input.material.recordedOn = draft.recordedOn;
  if (angle) input.brief.angle = angle;
  return input;
}
