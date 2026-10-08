import { articleBodyFromRun, briefHash, firstName, PRODUCTION_STATUS_LABELS } from '../../../domain/index.ts';
import type { ArticleBody, Brief, GenerationRun, PieceId, PieceStatus, ProductionStatus, RunFold, Suggestion, TextRange } from '../../../domain/index.ts';
import type { PieceApproval, PieceView, RunView } from '../../../ports/index.ts';
import { copilotTool } from '../../../registries/index.ts';
import type { CopilotTool } from '../../../registries/index.ts';
import { isBlankBody } from './studio-model.ts';
import type { ComposerChip, SessionTurn, StreamMode, SuggestionFocus } from './studio-types.ts';

/**
 * Pure rules of the article studio session (no editor, no React): which generation is on
 * screen, the text the checks read while it writes, the assistant thread rebuilt after a reload,
 * what a composer request carries, the suggestion the bar points at and the ONE primary of the
 * header with the next step written on it (or none).
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

export type StudioBadge = { kind: 'piece'; status: PieceView['status']; label: string } | { kind: 'production'; status: 'unauthorized'; label: string };

/**
 * The studio header's badge: the article's own status in newsroom words (never the production's,
 * which follows the carousel once the article is approved), except while the material is not
 * authorized and nothing was written — then it says why, as the list and Material do.
 */
export function studioBadge(piece: Pick<PieceView, 'status' | 'statusLabel'>, productionStatus: ProductionStatus | undefined): StudioBadge {
  if (productionStatus === 'unauthorized' && (piece.status === 'not_started' || piece.status === 'locked')) {
    return { kind: 'production', status: 'unauthorized', label: PRODUCTION_STATUS_LABELS.unauthorized };
  }
  return { kind: 'piece', status: piece.status, label: piece.statusLabel };
}

/** The brief changed after the run wrote the text on screen ("Reescrever o artigo do zero" would follow the new one). */
export function briefChangedSince(run: Pick<GenerationRun, 'inputs'> | undefined, brief: Brief): boolean {
  const used = run?.inputs.find((ref) => ref.kind === 'brief');
  return used?.kind === 'brief' && used.hash !== briefHash(brief);
}

/** Why nothing changes in a tab another tab took over (A10); the same words as the store's refusal (COPY §2.1). */
export const READ_ONLY_REASON = 'Aberta em outra aba: escolha “Usar esta aba” para editar aqui.';

/** The header primary of the studio (COPY §2.1), as data: the screen turns it into a button or a link. */
export type StudioPrimaryKind = 'send' | 'resend' | 'review' | 'create_carousel' | 'open_carousel' | 'delivery' | 'structure';
export type StudioPrimary = { kind: StudioPrimaryKind; label: string; blockedReason?: string };

export type StudioPrimaryInput = {
  /** The article's status. */
  status: PieceStatus;
  /** The AI writes the text right now (the banner carries "Parar"). */
  generating: boolean;
  approval?: Pick<PieceApproval, 'state' | 'viewer' | 'send' | 'decision'>;
  /** The material is authorized (the AI may write the article). */
  authorized: boolean;
  /** The carousel of the plan, when there is one. */
  carousel?: { status: PieceStatus };
  /** Another tab of this browser edits this production (A10). */
  tabReadOnly: boolean;
};

/**
 * ONE primary with the next step on it (D2, P3, CONTRACT §3.8): "Enviar para aprovação" ·
 * "Reenviar para Pedro" (adjustments) · "Reenviar para aprovação" (approved text changed) ·
 * "Revisar artigo" (whoever decides, while it waits) · "Criar carrossel" / "Abrir o carrossel" /
 * "Ir para entrega" (approved) · "Montar estrutura" (no text yet). None while the AI writes, after
 * an error (the banner's "Tentar de novo"), while the author waits for the decision, or when the
 * viewer cannot do the next step (P8). Sending is blocked with a visible reason only when it is
 * impossible (another tab, nobody can approve); what is missing in the text shows in the dialog.
 */
export function studioPrimary(input: StudioPrimaryInput): StudioPrimary | null {
  const { status, approval } = input;
  if (input.generating || status === 'generating' || status === 'failed') return null;
  const state = approval?.state ?? 'none';
  const viewer = approval?.viewer;
  if (state === 'awaiting') return viewer?.canDecide ? { kind: 'review', label: 'Revisar artigo' } : null;
  if (status === 'not_started' || status === 'locked') {
    return input.authorized && viewer?.canEdit !== false ? { kind: 'structure', label: 'Montar estrutura' } : null;
  }
  if (state === 'approved') {
    const carousel = input.carousel;
    if (carousel && carousel.status !== 'approved') {
      if (viewer?.canEdit === false) return null;
      return carousel.status === 'not_started' || carousel.status === 'locked'
        ? { kind: 'create_carousel', label: 'Criar carrossel' }
        : { kind: 'open_carousel', label: 'Abrir o carrossel' };
    }
    return { kind: 'delivery', label: 'Ir para entrega' };
  }
  if (!approval || !viewer?.canSend) return null;
  const guard = approval.send.guard;
  const blockedReason = input.tabReadOnly ? READ_ONLY_REASON : guard.allowed ? undefined : guard.reason;
  const blocked = blockedReason ? { blockedReason } : {};
  if (state === 'changes_requested') {
    const name = firstName(approval.decision?.decider?.name);
    return { kind: 'resend', label: name ? `Reenviar para ${name}` : 'Reenviar para aprovação', ...blocked };
  }
  if (state === 'approval_outdated') return { kind: 'resend', label: 'Reenviar para aprovação', ...blocked };
  return { kind: 'send', label: 'Enviar para aprovação', ...blocked };
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
