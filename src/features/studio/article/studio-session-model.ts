import { articleBodyFromRun, briefHash, PRODUCTION_STATUS_LABELS } from '../../../domain/index.ts';
import type { ArticleBody, Brief, CheckResult, GenerationRun, PieceId, ProductionStatus, RunFold, Suggestion, TextRange } from '../../../domain/index.ts';
import type { Guard, PieceView, RunView } from '../../../ports/index.ts';
import { copilotTool } from '../../../registries/index.ts';
import type { CopilotTool } from '../../../registries/index.ts';
import { isBlankBody } from './studio-model.ts';
import type { ComposerChip, SessionTurn, StreamMode, SuggestionFocus } from './studio-types.ts';

/**
 * Pure rules of the article studio session (no editor, no React): which generation is on
 * screen, the text the checks read while it writes, the copilot thread rebuilt after a reload,
 * what a composer request carries, the suggestion the bar points at and why the piece cannot be
 * sent for approval yet.
 */

/** Runs whose suggestions read as turns of the copilot thread. */
const ASSIST_KINDS = new Set(['article.assist', 'article.titles']);

/** Article generations of the piece, oldest first (continuations stay under their parent run). */
export function generationRunsOf(runs: readonly RunView[], pieceId: PieceId): RunView[] {
  return runs.filter((run) => run.pieceId === pieceId && run.kind === 'article.generate' && !run.parentRunId);
}

/**
 * The text the status line, the Checagem and the outline read. While a generation writes over an
 * empty text (or replaces it), that is what the run wrote so far, with the cover on screen kept.
 */
export function factsBodyOf(body: ArticleBody, title: string, writing?: { fold: RunFold; mode: StreamMode }): ArticleBody {
  const written = writing && (writing.mode === 'replace' || isBlankBody(body)) ? articleBodyFromRun(writing.fold, { includePartial: true }) : undefined;
  if (written) return body.cover ? { ...written, cover: body.cover } : written;
  return { ...body, title };
}

/**
 * How a retried generation reaches the text: a "Gerar nova versão" stopped or failed before
 * writing anything still replaces the text on screen; once it wrote blocks, it picks up after them.
 */
export function continuationMode(mode: StreamMode, writtenBlocks: number): StreamMode {
  return mode === 'replace' && writtenBlocks === 0 ? 'replace' : 'append';
}

/** Runs with open suggestions not yet shown in the thread, in order of first appearance. */
export function unpinnedRunIds(open: readonly Pick<Suggestion, 'runId'>[], pinned: readonly string[]): string[] {
  return [...new Set(open.map((suggestion) => suggestion.runId))].filter((runId) => !pinned.includes(runId));
}

/**
 * Persisted assist runs this tab did not start (after a reload), as turns of the thread: the
 * request reads as the label of its first suggestion. Once shown, a run stays in the thread.
 */
export function assistTurnsOf(input: {
  runs: readonly RunView[];
  pieceId: PieceId;
  pinned: readonly string[];
  turns: readonly Pick<SessionTurn, 'runId'>[];
  suggestions: readonly Pick<Suggestion, 'runId' | 'label'>[];
}): SessionTurn[] {
  const own = new Set(input.turns.map((turn) => turn.runId).filter(Boolean));
  const shown = new Set(input.pinned);
  return input.runs
    .filter((run) => run.pieceId === input.pieceId && !run.parentRunId && ASSIST_KINDS.has(run.kind) && shown.has(run.id) && !own.has(run.id))
    .map((run) => {
      const first = input.suggestions.find((suggestion) => suggestion.runId === run.id);
      return { id: `run-${run.id}`, runId: run.id, prompt: first?.label ?? run.label, chips: [], at: Date.parse(run.createdAt) };
    });
}

/** The passage pinned to the composer ("Seleção · …"), the target of the next request. */
export function selectionTarget(chips: readonly ComposerChip[]): TextRange[] | undefined {
  const chip = chips.find((entry) => entry.kind === 'selection');
  return chip && chip.kind === 'selection' ? chip.ranges : undefined;
}

/** What the model reads for a typed question: the text, then each excerpt or note in quotes. */
export function askQuestion(text: string, chips: readonly ComposerChip[]): string {
  const excerpts = chips.filter((chip) => chip.kind === 'excerpt' || chip.kind === 'note').map((chip) => `“${chip.text}”`);
  return [text, ...excerpts].join('\n\n');
}

/** The open suggestion the bar near the text points at (title proposals never sit in the text). */
export function focusedSuggestionOf<S extends Pick<Suggestion, 'id' | 'runId' | 'proposal' | 'target'>>(
  focus: SuggestionFocus,
  open: readonly S[],
): S | undefined {
  if (!focus) return undefined;
  const inText = open.filter((suggestion) => suggestion.proposal.kind !== 'title' && suggestion.target.length > 0);
  if (focus.suggestionId) return inText.find((suggestion) => suggestion.id === focus.suggestionId);
  return inText.find((suggestion) => suggestion.runId === focus.runId);
}

/**
 * The article's own status in the studio header (never the production's, which follows the
 * carousel once the article is approved): "Aprovado · v2" while the approved version is the text
 * on screen; "Em edição" once the text moves on from it (a new draft; the approval stays on v2).
 */
export function articleStatusOf(piece: Pick<PieceView, 'status' | 'statusLabel' | 'approvedVersion' | 'latestVersion' | 'draft'>): {
  status: PieceView['status'];
  label: string;
} {
  const approved = piece.approvedVersion;
  if (piece.status === 'approved' && approved) {
    const onScreen = approved.id === piece.latestVersion?.id && !piece.draft.dirty;
    return onScreen ? { status: 'approved', label: `Aprovado · v${approved.number}` } : { status: 'draft', label: 'Em edição' };
  }
  return { status: piece.status, label: piece.status === 'draft' ? 'Em edição' : piece.statusLabel };
}

export type StudioBadge = { kind: 'piece'; status: PieceView['status']; label: string } | { kind: 'production'; status: 'unauthorized'; label: string };

/**
 * The studio header's badge: the article's own status, except while the material is not
 * authorized and nothing was written — then it says why, as the list and Material do.
 */
export function studioBadge(
  piece: Pick<PieceView, 'status' | 'statusLabel' | 'approvedVersion' | 'latestVersion' | 'draft'>,
  productionStatus: ProductionStatus | undefined,
): StudioBadge {
  if (productionStatus === 'unauthorized' && (piece.status === 'not_started' || piece.status === 'locked')) {
    return { kind: 'production', status: 'unauthorized', label: PRODUCTION_STATUS_LABELS.unauthorized };
  }
  return { kind: 'piece', ...articleStatusOf(piece) };
}

/** The approved version is the text on screen: editing it starts a new draft (A05). */
export function approvedOnScreen(piece: Pick<PieceView, 'approvedVersion' | 'latestVersion' | 'draft'>): PieceView['approvedVersion'] {
  const approved = piece.approvedVersion;
  return approved && approved.id === piece.latestVersion?.id && !piece.draft.dirty ? approved : undefined;
}

/** The brief changed after the run wrote the text on screen ("Gerar nova versão" would follow the new one). */
export function briefChangedSince(run: Pick<GenerationRun, 'inputs'> | undefined, brief: Brief): boolean {
  const used = run?.inputs.find((ref) => ref.kind === 'brief');
  return used?.kind === 'brief' && used.hash !== briefHash(brief);
}

/** A sentence for a tooltip: the detail of a check, ending with a period. */
function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * Why "Enviar para aprovação" is blocked, in the order the person can act on it (null: allowed).
 * A failing blocking check of the text on screen ("Geração concluída") blocks it too: the approver
 * would only find a request they cannot approve.
 */
/** Why nothing changes in a tab another tab took over (A10); the same words as the store's refusal. */
export const READ_ONLY_REASON = 'Aberta em outra aba: escolha “Usar esta aba” para editar aqui.';

export function reviewRequestBlock(input: {
  busy: boolean;
  openCount: number;
  conflict: boolean;
  empty: boolean;
  /** Blocking checks that fail (`readiness(checks).blockers`). */
  blockers?: readonly Pick<CheckResult, 'label' | 'detail'>[];
  guard?: Guard;
  /** Another tab of this browser edits this production (A10). */
  readOnly?: boolean;
}): string | null {
  const { busy, openCount, conflict, empty, blockers = [], guard, readOnly = false } = input;
  if (readOnly) return READ_ONLY_REASON;
  if (busy) return 'Aguarde a geração terminar.';
  if (openCount > 0) return `Decida ${openCount === 1 ? 'a sugestão aberta' : `as ${openCount} sugestões abertas`} antes de enviar.`;
  if (conflict) return 'O texto foi alterado em outra aba. Recarregue a página.';
  if (empty) return 'Escreva ou gere o texto antes de enviar.';
  const [blocker] = blockers;
  if (blocker) return sentence(blocker.detail ?? `${blocker.label} pendente`);
  if (guard && !guard.allowed && guard.code !== 'already_requested') return guard.reason;
  return null;
}

const LABEL_TOOLS: Record<string, string> = {
  'Mais direto': 'rewrite.direct',
  Didático: 'rewrite.didactic',
  Formal: 'rewrite.formal',
  Encurtar: 'shorten',
  'Expandir com a fonte': 'expand-with-source',
  'Virar lista': 'to-list',
  'Título alternativo': 'titles',
  'Títulos alternativos': 'titles',
  'Sugerir intertítulos': 'suggest-subheadings',
  'Ajustar trecho': 'rewrite.direct',
};

/** The copilot tool that produced a suggestion (by its action label), to run it again. */
export function toolForSuggestion(suggestion: Pick<Suggestion, 'label' | 'proposal'>): CopilotTool | undefined {
  if (suggestion.proposal.kind === 'title') return copilotTool('titles');
  const id = suggestion.label ? LABEL_TOOLS[suggestion.label] : undefined;
  return id ? copilotTool(id) : undefined;
}
