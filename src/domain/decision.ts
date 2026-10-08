import type { ImageRightsRecord } from './asset.ts';
import type { CheckResult } from './checks.ts';
import type { DecisionId, GateId, IsoDateTime, PersonId, ReviewRequestId } from './ids.ts';
import type { PieceKind } from './piece.ts';
import type { DecisionSubject, TextRange, VersionRef } from './refs.ts';
import type { Role } from './workspace.ts';

/**
 * Generic gate record (REQ-T.6). R1 decides on piece versions; the same record later covers
 * opportunities/pautas (F3.6), news items (F2.2/F2.4) and avatar/voice assets (REQ-5.19/5.20).
 */
export type DecisionKind = 'approved' | 'changes_requested' | 'rejected' | 'selected' | 'discarded';

/** A passage the decision points at ("devolver com nota" anchored to selected text). */
export type DecisionAnchor = TextRange & { excerpt?: string };

export type Decision = {
  id: DecisionId;
  gate: GateId;
  subject: DecisionSubject;
  decision: DecisionKind;
  by: PersonId;
  at: IsoDateTime;
  note?: string;
  anchors?: DecisionAnchor[];
  /** Readiness checks as they were when the decision was made. */
  checks: CheckResult[];
  /** Credit and rights of the article images as they were when the decision was made. */
  images?: ImageRightsRecord[];
};

/** "Enviar para aprovação": a version waiting at a gate until a decision is recorded. */
export type ReviewRequest = {
  id: ReviewRequestId;
  gate: GateId;
  subject: VersionRef;
  requestedBy: PersonId;
  requestedAt: IsoDateTime;
  /** "Recado": what the sender tells the approver. */
  note?: string;
  /** "Quem aprova". Absent (legacy requests): any member with the gate role may pick it up. */
  assigneeId?: PersonId;
  /** "Para quando": local calendar date `YYYY-MM-DD`. */
  dueOn?: string;
  /** "Retirar envio": the request stops waiting for a decision (the text is editable again). */
  withdrawnAt?: IsoDateTime;
  withdrawnBy?: PersonId;
};

export type GateDefinition = {
  id: GateId;
  label: string;
  pieceKind?: PieceKind;
  /** Roles allowed to decide. */
  roles: Role[];
  decisions: DecisionKind[];
  /** Decisions that need a written note. */
  requiresNote: DecisionKind[];
};

export const ARTICLE_GATE: GateDefinition = {
  id: 'article.approval',
  label: 'Aprovação do artigo',
  pieceKind: 'article',
  roles: ['approver', 'admin'],
  decisions: ['approved', 'changes_requested'],
  requiresNote: ['changes_requested', 'rejected'],
};

export const CAROUSEL_GATE: GateDefinition = {
  id: 'carousel.approval',
  label: 'Aprovação do carrossel',
  pieceKind: 'carousel',
  roles: ['creative_reviewer', 'approver', 'admin'],
  decisions: ['approved', 'changes_requested'],
  requiresNote: ['changes_requested', 'rejected'],
};

export const R1_GATES: readonly GateDefinition[] = [ARTICLE_GATE, CAROUSEL_GATE];

export function gateForPiece(kind: PieceKind, gates: readonly GateDefinition[] = R1_GATES): GateDefinition | undefined {
  return gates.find((gate) => gate.pieceKind === kind);
}

export const DECISION_LABELS: Record<DecisionKind, string> = {
  approved: 'Aprovado',
  changes_requested: 'Ajustes solicitados',
  rejected: 'Recusado',
  selected: 'Selecionado',
  discarded: 'Descartado',
};
