import { approvalStateOf, dueStateOf, isLocked, requestRound } from '../../../domain/approval.ts';
import { gateForPiece } from '../../../domain/decision.ts';
import type { Decision, ReviewRequest } from '../../../domain/decision.ts';
import type { Piece } from '../../../domain/piece.ts';
import { findVersion, latestApproved, pendingReview, pieceDecisions } from '../../../domain/record.ts';
import type { ProductionRecord } from '../../../domain/record.ts';
import { REQUESTER_MAY_DECIDE } from '../../../domain/rules/decide.ts';
import { toVersionView } from '../../../domain/views.ts';
import type { ProductionView } from '../../../domain/views.ts';
import { hasAnyRole } from '../../../domain/workspace.ts';
import type { PersonSummary } from '../../../ports/common.ts';
import type { ApprovalDecisionView, ApprovalRequestView, PieceApproval, ProductionDetail, ProductionGuards } from '../../../ports/production-queries.ts';
import { pieceGuards } from './guards.ts';
import { currentMember, personOf, toPersonSummary } from './people.ts';
import { gateMembers, suggestedAssignee, sendItemsOf } from './send-check.ts';
import type { ReadContext } from './read-context.ts';

/**
 * `PieceApproval` read model: state, requests and decisions in the writer's words, the pre-send
 * checklist and what the acting member may do (CONTRACT §2.3).
 */

function requestView(ctx: ReadContext, record: ProductionRecord, request: ReviewRequest): ApprovalRequestView | undefined {
  const version = findVersion(record, request.subject.versionId);
  if (!version) return undefined;
  const view: ApprovalRequestView = {
    id: request.id,
    requester: personOf(ctx.state, request.requestedBy),
    assignee: request.assigneeId ? personOf(ctx.state, request.assigneeId) : null,
    requestedAt: request.requestedAt,
    due: dueStateOf(request.dueOn, ctx.now),
    round: requestRound(record, request),
    version: toVersionView(record, version),
  };
  if (request.note) view.note = request.note;
  if (request.dueOn) view.dueOn = request.dueOn;
  if (request.withdrawnAt) view.withdrawnAt = request.withdrawnAt;
  return view;
}

function decisionView(ctx: ReadContext, record: ProductionRecord, decision: Decision): ApprovalDecisionView | undefined {
  if (decision.subject.kind !== 'version') return undefined;
  if (decision.decision !== 'approved' && decision.decision !== 'changes_requested') return undefined;
  const version = findVersion(record, decision.subject.versionId);
  if (!version) return undefined;
  const view: ApprovalDecisionView = {
    kind: decision.decision,
    decider: personOf(ctx.state, decision.by),
    at: decision.at,
    anchors: decision.anchors ? decision.anchors.map((anchor) => ({ ...anchor })) : [],
    version: toVersionView(record, version),
  };
  if (decision.note) view.note = decision.note;
  return view;
}

const defined = <T>(value: T | undefined): value is T => value !== undefined;

type ApprovalViewInput = Pick<ProductionView, 'pieces'>;

/**
 * Approval of one piece for the acting member; undefined when the piece passes no gate. Pass the
 * production's guards when they are already computed (the detail view).
 */
export function pieceApproval(ctx: ReadContext, record: ProductionRecord, piece: Piece, view: ApprovalViewInput, guards?: ProductionGuards): PieceApproval | undefined {
  const gate = gateForPiece(piece.kind, ctx.gates);
  if (!gate) return undefined;
  const viewer = currentMember(ctx.state);
  const pending = pendingReview(record, piece.id);
  const requests = record.reviewRequests
    .filter((request) => request.subject.pieceId === piece.id)
    .sort((a, b) => Date.parse(a.requestedAt) - Date.parse(b.requestedAt))
    .map((request) => requestView(ctx, record, request))
    .filter(defined);
  const decisions = pieceDecisions(record, piece.id)
    .map((decision) => decisionView(ctx, record, decision))
    .filter(defined);
  const approvers = gateMembers(ctx.state, gate, viewer?.personId)
    .map((member) => ctx.state.people.find((person) => person.id === member.personId))
    .filter(defined)
    .map(toPersonSummary);
  const suggestedId = suggestedAssignee(ctx.state, record, piece, gate, viewer?.personId);
  const suggested = approvers.find((person) => person.id === suggestedId);
  const ordered: PersonSummary[] = suggested ? [suggested, ...approvers.filter((person) => person.id !== suggested.id)] : approvers;
  const pieceView = view.pieces.find((entry) => entry.id === piece.id);
  const isRequester = pending !== undefined && viewer !== undefined && pending.requestedBy === viewer.personId;
  const canEdit = hasAnyRole(viewer, ['editor', 'admin']);
  const approval: PieceApproval = {
    pieceId: piece.id,
    kind: piece.kind,
    gateId: gate.id,
    state: approvalStateOf(record, piece.id),
    requests,
    decisions,
    locked: isLocked(record, piece.id),
    send: {
      guard: (guards?.pieces[piece.kind] ?? pieceGuards(ctx, record, piece.kind)).requestReview,
      items: sendItemsOf(record, piece, { templates: ctx.templates, assets: ctx.assets, ...(pieceView ? { checks: pieceView.checks } : {}) }),
      approvers: ordered,
      // A send taken back ("Retirar envio") does not make the next one a resend.
      isResend: requests.some((entry) => entry.withdrawnAt === undefined),
    },
    viewer: {
      canEdit,
      canSend: canEdit,
      canDecide: hasAnyRole(viewer, gate.roles) && (REQUESTER_MAY_DECIDE || !isRequester),
      canWithdraw: pending !== undefined && (isRequester || hasAnyRole(viewer, ['admin'])),
      isRequester,
      isAssignee: pending?.assigneeId !== undefined && pending.assigneeId === viewer?.personId,
    },
  };
  if (suggested) approval.send.suggestedAssigneeId = suggested.id;
  const request = pending ? requests.find((entry) => entry.id === pending.id) : undefined;
  if (request) approval.request = request;
  const decision = decisions[decisions.length - 1];
  if (decision) approval.decision = decision;
  const approved = latestApproved(record, piece.id);
  if (approved) approval.approvedVersion = toVersionView(record, approved.version);
  return approval;
}

/** `ProductionDetail.approvals`: every planned piece that exists and passes a gate. */
export function productionApprovals(ctx: ReadContext, record: ProductionRecord, view: ApprovalViewInput, guards?: ProductionGuards): ProductionDetail['approvals'] {
  const approvals: ProductionDetail['approvals'] = {};
  for (const piece of record.pieces) {
    const approval = pieceApproval(ctx, record, piece, view, guards);
    if (approval) approvals[piece.kind] = approval;
  }
  return approvals;
}
