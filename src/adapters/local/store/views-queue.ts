import { dueStateOf, requestRound } from '../../../domain/approval.ts';
import type { DueState } from '../../../domain/approval.ts';
import { articleCharacters } from '../../../domain/article.ts';
import { gateForPiece } from '../../../domain/decision.ts';
import type { Decision, ReviewRequest } from '../../../domain/decision.ts';
import type { PieceId } from '../../../domain/ids.ts';
import { PIECE_LABELS } from '../../../domain/piece.ts';
import type { Piece, Version } from '../../../domain/piece.ts';
import { findVersion, pendingReview } from '../../../domain/record.ts';
import type { ProductionRecord } from '../../../domain/record.ts';
import { hasAnyRole } from '../../../domain/workspace.ts';
import type { Member } from '../../../domain/workspace.ts';
import type { ApprovalItem, ApprovalsPage, ApprovalsTab } from '../../../ports/production-queries.ts';
import { currentMember, personOf } from './people.ts';
import { recordOf } from './read-context.ts';
import type { ReadContext } from './read-context.ts';

/**
 * "Aprovações" (D10): the acting member's queue ("Para aprovar") and their past decisions
 * ("Aprovadas por mim", "Devolvidas"). The Início desk and the menu count read the same queue, so
 * "2 peças esperam sua aprovação", the group count and "Aprovações 2" always agree.
 */

/** Most decisions a decided tab lists. */
export const DECIDED_LIMIT = 50;

/** Overdue first, then today, later dates, no date. */
const DUE_RANK: Record<DueState, number> = { overdue: 0, today: 1, later: 2, none: 3 };

type Pending = { record: ProductionRecord; piece: Piece; request: ReviewRequest; version: Version };

function itemOf(ctx: ReadContext, record: ProductionRecord, piece: Piece, version: Version, request: ReviewRequest | undefined): ApprovalItem {
  const item: ApprovalItem = {
    productionId: record.production.id,
    productionTitle: record.production.title,
    pieceId: piece.id,
    kind: piece.kind,
    pieceLabel: PIECE_LABELS[piece.kind],
    requester: request ? personOf(ctx.state, request.requestedBy) : null,
    requestedAt: request?.requestedAt ?? version.createdAt,
    due: 'none',
    round: request ? requestRound(record, request) : 1,
  };
  if (request?.note) item.note = request.note;
  if (request?.dueOn) item.dueOn = request.dueOn;
  if (version.body.type === 'article') {
    item.characters = articleCharacters(version.body);
    item.size = record.production.brief.size;
  } else {
    item.slides = version.body.slides.length;
  }
  return item;
}

/** Whether a pending send is in this member's "Para aprovar": assigned to them, or unassigned and theirs to decide. */
export function isInQueue(ctx: Pick<ReadContext, 'gates'>, viewer: Member, piece: Piece, request: ReviewRequest): boolean {
  const gate = gateForPiece(piece.kind, ctx.gates);
  if (!gate || !hasAnyRole(viewer, gate.roles)) return false;
  if (request.requestedBy === viewer.personId) return false;
  return request.assigneeId === undefined || request.assigneeId === viewer.personId;
}

function pendingFor(ctx: ReadContext, viewer: Member): Pending[] {
  const pending: Pending[] = [];
  for (const production of ctx.state.productions) {
    if (production.production.archivedAt) continue;
    const record = recordOf(ctx, production);
    for (const piece of record.pieces) {
      const request = pendingReview(record, piece.id);
      if (!request || !isInQueue(ctx, viewer, piece, request)) continue;
      const version = findVersion(record, request.subject.versionId);
      if (version) pending.push({ record, piece, request, version });
    }
  }
  return pending;
}

/** "Para aprovar" of the acting member: overdue, today, later, no date; then the oldest send first. */
export function toApproveItems(ctx: ReadContext): ApprovalItem[] {
  const viewer = currentMember(ctx.state);
  if (!viewer) return [];
  const items = pendingFor(ctx, viewer).map(({ record, piece, request, version }) => {
    const item = itemOf(ctx, record, piece, version, request);
    item.due = dueStateOf(request.dueOn, ctx.now);
    return item;
  });
  return items.sort(
    (a, b) =>
      DUE_RANK[a.due] - DUE_RANK[b.due] ||
      (a.due === 'later' && b.due === 'later' ? (a.dueOn ?? '').localeCompare(b.dueOn ?? '') : 0) ||
      Date.parse(a.requestedAt) - Date.parse(b.requestedAt) ||
      a.pieceId.localeCompare(b.pieceId),
  );
}

/** The send a decision answered: the latest one on that version made before it. */
function answeredRequest(record: ProductionRecord, decision: Decision): ReviewRequest | undefined {
  const subject = decision.subject;
  if (subject.kind !== 'version') return undefined;
  return record.reviewRequests
    .filter((request) => request.subject.versionId === subject.versionId && request.withdrawnAt === undefined && Date.parse(request.requestedAt) <= Date.parse(decision.at))
    .sort((a, b) => Date.parse(a.requestedAt) - Date.parse(b.requestedAt))
    .pop();
}

/** The acting member's decisions of one kind, one row per piece (the latest), newest first. */
function decidedItems(ctx: ReadContext, kind: 'approved' | 'changes_requested'): ApprovalItem[] {
  const viewer = currentMember(ctx.state);
  if (!viewer) return [];
  const latest = new Map<PieceId, ApprovalItem>();
  for (const production of ctx.state.productions) {
    const record = recordOf(ctx, production);
    for (const decision of record.decisions) {
      const subject = decision.subject;
      if (decision.by !== viewer.personId || decision.decision !== kind || subject.kind !== 'version') continue;
      const piece = record.pieces.find((entry) => entry.id === subject.pieceId);
      const version = findVersion(record, subject.versionId);
      if (!piece || !version) continue;
      const known = latest.get(piece.id);
      if (known?.decidedAt && Date.parse(known.decidedAt) >= Date.parse(decision.at)) continue;
      const item = itemOf(ctx, record, piece, version, answeredRequest(record, decision));
      item.decision = kind;
      item.decidedAt = decision.at;
      if (decision.note) item.decisionNote = decision.note;
      latest.set(piece.id, item);
    }
  }
  return [...latest.values()].sort((a, b) => Date.parse(b.decidedAt ?? '') - Date.parse(a.decidedAt ?? '') || a.pieceId.localeCompare(b.pieceId));
}

/** "Aprovações": one tab's rows plus the count of every tab (empty for members who cannot decide). */
export function approvalsPage(ctx: ReadContext, tab: ApprovalsTab): ApprovalsPage {
  const toApprove = toApproveItems(ctx);
  const approved = decidedItems(ctx, 'approved');
  const returned = decidedItems(ctx, 'changes_requested');
  const rows: Record<ApprovalsTab, ApprovalItem[]> = {
    to_approve: toApprove,
    approved_by_me: approved.slice(0, DECIDED_LIMIT),
    returned: returned.slice(0, DECIDED_LIMIT),
  };
  return { tab, items: rows[tab], counts: { to_approve: toApprove.length, approved_by_me: approved.length, returned: returned.length } };
}
