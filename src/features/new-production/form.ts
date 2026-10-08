import {
  DEFAULT_SECTIONS,
  LENGTH_TARGETS,
  R1_FLOW,
  foldForMatch,
  readiness,
  runChecks,
} from '../../domain/index.ts';
import type { ArticleLength, PieceKind, Source, SourceOrigin, StageDefinition, TranscriptFormat } from '../../domain/index.ts';
import type { NewProductionInput, SourceAnalysis, SpeakerAssignment } from '../../ports/index.ts';
import { generationChecksFor } from '../../registries/index.ts';

/**
 * Nova produção as a pure form model (PLAN §3.3): the draft the screen edits, the validation
 * behind ErrorSummary, the "Gerar artigo" gate (the registry's generation checks run on the
 * source this form would create) and the command input. No React, no clock: node-testable.
 */

export type MaterialMode = 'paste' | 'file';

/** "Entregas": the article is mandatory; the carousel is the optional derivative. */
export type DeliveryPlan = 'article' | 'article-carousel';

/**
 * "Falantes": a detected label linked to a workspace person, a new person ("Participantes":
 * name, role, organisation), explicitly nobody ("Sem atribuição"), or still undecided (`unset`,
 * which "Gerar artigo" reports as "sem pessoa").
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
  title: string;
  origin: SourceOrigin;
  /** YYYY-MM-DD or empty. */
  recordedOn: string;
  authorized: boolean;
  angle: string;
  sections: number;
  length: ArticleLength;
  plan: DeliveryPlan;
  /** Explicit choices only; labels without one use `suggestSpeaker`. */
  speakers: Readonly<Record<string, SpeakerChoice>>;
};

export type PersonOption = { id: string; name: string };

export const EMPTY_DRAFT: NewProductionDraft = {
  mode: 'paste',
  pasted: '',
  file: null,
  title: '',
  origin: 'interview',
  recordedOn: '',
  authorized: false,
  angle: '',
  sections: DEFAULT_SECTIONS,
  length: 'medium',
  plan: 'article-carousel',
  speakers: {},
};

export const MAX_TITLE_LENGTH = 120;
export const MAX_ANGLE_LENGTH = 600;

export const SECTION_OPTIONS = ['2', '3', '4', '5'] as const;

export const FORMAT_LABELS: Record<TranscriptFormat, string> = {
  plain: 'Texto corrido',
  'speaker-lines': 'Falas com nome',
  srt: 'Legenda SRT',
  vtt: 'Legenda VTT',
};

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
    draft.sections !== EMPTY_DRAFT.sections ||
    draft.length !== EMPTY_DRAFT.length ||
    draft.plan !== EMPTY_DRAFT.plan ||
    Object.keys(draft.speakers).length > 0
  );
}

/** "entrevista-atelie_sul.txt" → "Entrevista atelie sul". */
export function titleFromFileName(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return stem ? stem.charAt(0).toLocaleUpperCase('pt-BR') + stem.slice(1) : '';
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

/** Name shown for a speaker in previews: the linked person, the new name, or the raw label. */
export function speakerDisplayName(choice: SpeakerChoice, label: string, people: readonly PersonOption[]): string {
  if (choice.kind === 'person') return people.find((person) => person.id === choice.personId)?.name ?? label;
  if (choice.kind === 'new') return choice.name.trim() || label;
  return label;
}

// ── Brief and plan ───────────────────────────────────────────────────────────────────────

export function planKinds(plan: DeliveryPlan): PieceKind[] {
  return plan === 'article' ? ['article'] : ['article', 'carousel'];
}

/** The journey this production will follow (the Stepper in the frame header). */
export function plannedStages(plan: DeliveryPlan): StageDefinition[] {
  const kinds = planKinds(plan);
  return R1_FLOW.stages.filter((stage) => stage.kind !== 'piece' || (stage.pieceKind !== undefined && kinds.includes(stage.pieceKind)));
}

export function lengthWords(length: ArticleLength): number {
  return LENGTH_TARGETS[length].words;
}

export function structureLabel(sections: number): string {
  return `Introdução + ${sections} ${sections === 1 ? 'seção' : 'seções'}`;
}

// ── Validation and gate ──────────────────────────────────────────────────────────────────

export type DraftField = 'material' | 'title' | `speaker:${string}`;

/** `unattributed`: a speaker still without a person (only "Gerar artigo" asks for it). */
export type DraftIssue = { field: DraftField; label: string; message: string; unattributed?: true };

export const SPEAKER_UNSET_MESSAGE = 'Escolha quem fala ou “Sem atribuição”.';

/** Labels of the material still without a person or an explicit "Sem atribuição". */
export function speakersWithoutPerson(draft: Pick<NewProductionDraft, 'speakers'>, analysis: SourceAnalysis | undefined, people: readonly PersonOption[]): string[] {
  return (analysis?.speakers ?? []).filter((speaker) => speakerChoice(draft, speaker.label, people).kind === 'unset').map((speaker) => speaker.label);
}

/** "2 falantes sem pessoa" (ErrorSummary and the Falantes section). */
export function withoutPersonLabel(count: number): string {
  return `${count} ${count === 1 ? 'falante' : 'falantes'} sem pessoa`;
}

/**
 * What blocks saving or generating, in screen order. While the material is still being read
 * (`analysis` undefined with text present) nothing is reported for it: the screen waits.
 * Generating also needs every speaker decided (a person, or "Sem atribuição"), since quotes
 * are attributed from here (REQ-T.7); a draft can be saved without it.
 */
export function validateDraft(
  draft: NewProductionDraft,
  analysis: SourceAnalysis | undefined,
  people: readonly PersonOption[],
  intent: 'draft' | 'generate' = 'draft',
): DraftIssue[] {
  const issues: DraftIssue[] = [];
  if (!hasMaterial(draft)) {
    issues.push({ field: 'material', label: 'Transcrição', message: draft.mode === 'file' ? 'Envie o arquivo da transcrição.' : 'Cole a transcrição.' });
  }
  for (const speaker of analysis?.speakers ?? []) {
    const choice = speakerChoice(draft, speaker.label, people);
    if (choice.kind === 'new' && !choice.name.trim()) {
      issues.push({ field: `speaker:${speaker.label}`, label: speaker.label, message: 'Informe o nome da pessoa.' });
    }
    if (choice.kind === 'unset' && intent === 'generate') {
      issues.push({ field: `speaker:${speaker.label}`, label: speaker.label, message: SPEAKER_UNSET_MESSAGE, unattributed: true });
    }
  }
  if (!draft.title.trim()) issues.push({ field: 'title', label: 'Título interno', message: 'Dê um título interno à produção.' });
  return issues;
}

/** The source `createFromSource` would save, for the registry checks (never persisted). */
export function draftSource(draft: NewProductionDraft, analysis: SourceAnalysis): Source {
  return {
    id: 'draft-source',
    workspaceId: 'draft',
    kind: 'transcript',
    title: draft.title.trim() || 'Material',
    origin: draft.origin,
    speakers: analysis.speakers.map((speaker) => ({ label: speaker.label })),
    rights: { authorized: draft.authorized },
    versions: [
      {
        number: 1,
        hash: analysis.hash,
        content: { type: 'transcript', format: analysis.format, segments: analysis.segments },
        createdAt: '',
        createdBy: 'system',
      },
    ],
    createdAt: '',
    createdBy: 'system',
  };
}

/**
 * Why "Gerar artigo" is unavailable (Tooltip text), from the registry's generation checks
 * ("Material autorizado", REQ-T.1); `undefined` when generation may start.
 */
export function generationBlocker(draft: NewProductionDraft, analysis: SourceAnalysis | undefined): string | undefined {
  const sources = analysis && hasMaterial(draft) ? [draftSource(draft, analysis)] : [];
  const [blocker] = readiness(runChecks(generationChecksFor(), { sources })).blockers;
  return blocker ? (blocker.detail ?? blocker.label) : undefined;
}

// ── Command input ────────────────────────────────────────────────────────────────────────

export function toCreateInput(
  draft: NewProductionDraft,
  analysis: SourceAnalysis | undefined,
  people: readonly PersonOption[],
): NewProductionInput {
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
    brief: { sections: draft.sections, length: draft.length },
    plan: planKinds(draft.plan),
  };
  if (material.fileName) input.material.fileName = material.fileName;
  if (draft.recordedOn) input.material.recordedOn = draft.recordedOn;
  if (angle) input.brief.angle = angle;
  return input;
}
