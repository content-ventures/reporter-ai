import { lockedMessage as lockedPieceMessage, sendBlocker, sendBlockedMessage, sendChecklist } from '../../../domain/approval.ts';
import type { SendItem } from '../../../domain/approval.ts';
import { articleCharacters } from '../../../domain/article.ts';
import type { AssetLookup } from '../../../domain/asset.ts';
import { slotIssues } from '../../../domain/carousel.ts';
import type { CarouselTemplate } from '../../../domain/carousel.ts';
import type { CheckResult } from '../../../domain/checks.ts';
import type { GateDefinition, ReviewRequest } from '../../../domain/decision.ts';
import type { PersonId } from '../../../domain/ids.ts';
import type { Piece } from '../../../domain/piece.ts';
import { activeRun, pendingReview, pendingSuggestions, pieceDecisions } from '../../../domain/record.ts';
import type { ProductionRecord } from '../../../domain/record.ts';
import { evaluatePieceChecks } from '../../../domain/views.ts';
import { hasAnyRole } from '../../../domain/workspace.ts';
import type { Member } from '../../../domain/workspace.ts';
import { firstNameOf } from './people.ts';
import type { StoreState } from './state.ts';

/**
 * "Antes de enviar" for one piece, shared by the commands (they refuse a "Falta"), the guards and
 * the `PieceApproval` read model, so the dialog, the button and the command never disagree.
 */

export type SendCheckDeps = {
  templates: readonly CarouselTemplate[];
  assets?: AssetLookup;
  materialChars?: number;
  /** Checks already evaluated on the draft (the production view has them). */
  checks?: readonly CheckResult[];
};

/** The pre-send checklist of the piece's current draft. */
export function sendItemsOf(record: ProductionRecord, piece: Piece, deps: SendCheckDeps): SendItem[] {
  const body = piece.draft.body;
  const checks = deps.checks ?? evaluatePieceChecks(record, piece, body, deps.templates, deps.assets, deps.materialChars);
  const running = activeRun(record, piece.id) !== undefined;
  const openSuggestionIds = pendingSuggestions(record, piece.id).map((suggestion) => suggestion.id);
  if (body.type === 'article') {
    const characters = articleCharacters(body);
    return sendChecklist({ kind: piece.kind, checks, openSuggestionIds, running, empty: characters === 0, size: record.production.brief.size, characters });
  }
  const template = deps.templates.find((candidate) => candidate.id === body.templateId);
  return sendChecklist({
    kind: piece.kind,
    checks,
    openSuggestionIds,
    running,
    empty: body.slides.length === 0,
    slides: body.slides.length,
    slideIssues: template ? slotIssues(body, template).map((issue) => ({ slideId: issue.slideId, kind: issue.kind })) : [],
  });
}

export type SendRefusalCode = 'empty' | 'run_in_progress' | 'suggestion_pending' | 'checks_blocking' | 'send_blocked';

/** The refusal a "Falta" item gives "Enviar para aprovação" (codes kept from before the checklist). */
export function sendRefusal(items: readonly SendItem[]): { code: SendRefusalCode; message: string } | undefined {
  const blocker = sendBlocker(items);
  if (!blocker) return undefined;
  const message = sendBlockedMessage(blocker);
  switch (blocker.id) {
    case 'empty':
      return { code: 'empty', message };
    case 'suggestions':
      return { code: 'suggestion_pending', message };
    case 'generation':
      return { code: 'checks_blocking', message };
    default:
      return { code: 'send_blocked', message };
  }
}

/** Members who may decide at the gate, without `exclude` (the sender never decides on their send). */
export function gateMembers(state: Pick<StoreState, 'members'>, gate: GateDefinition, exclude?: PersonId): Member[] {
  return state.members.filter((member) => member.personId !== exclude && hasAnyRole(member, gate.roles));
}

/**
 * "Quem aprova" prefilled: the last decider of this piece, else whom the sender last sent to at
 * this gate (any production), else the only member who can approve. Always someone in `approvers`.
 */
export function suggestedAssignee(
  state: Pick<StoreState, 'members' | 'productions'>,
  record: ProductionRecord,
  piece: Piece,
  gate: GateDefinition,
  senderId: PersonId | undefined,
): PersonId | undefined {
  const approvers = new Set(gateMembers(state, gate, senderId).map((member) => member.personId));
  const lastDecider = pieceDecisions(record, piece.id)
    .filter((decision) => decision.decision === 'approved' || decision.decision === 'changes_requested')
    .map((decision) => decision.by)
    .filter((id) => approvers.has(id))
    .pop();
  if (lastDecider) return lastDecider;
  if (senderId) {
    const sent: ReviewRequest[] = state.productions
      .flatMap((production) => production.reviewRequests)
      .filter((request) => request.gate === gate.id && request.requestedBy === senderId && request.assigneeId !== undefined && approvers.has(request.assigneeId))
      .sort((a, b) => Date.parse(a.requestedAt) - Date.parse(b.requestedAt));
    const last = sent[sent.length - 1]?.assigneeId;
    if (last) return last;
  }
  return approvers.size === 1 ? [...approvers][0] : undefined;
}

/** "O texto está com Pedro para aprovação. Retire o envio para editar." (COPY §5.4; carousel: "O carrossel …"). */
export function lockedMessage(state: Pick<StoreState, 'people' | 'productions'>, request: ReviewRequest): string {
  const kind = state.productions.flatMap((record) => record.pieces).find((piece) => piece.id === request.subject.pieceId)?.kind ?? 'article';
  return lockedPieceMessage(kind, request.assigneeId ? firstNameOf(state, request.assigneeId) : undefined);
}

/** "Este texto já está com Pedro para aprovação." (COPY §5.4). */
export function alreadyRequestedMessage(state: Pick<StoreState, 'people'>, request: ReviewRequest): string {
  return request.assigneeId ? `Este texto já está com ${firstNameOf(state, request.assigneeId)} para aprovação.` : 'Este texto já está aguardando aprovação.';
}

/** The pending send that locks the piece's text, if any. */
export function lockOf(record: ProductionRecord, piece: Piece): ReviewRequest | undefined {
  return pendingReview(record, piece.id);
}
