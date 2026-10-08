import { gateForPiece } from './decision.ts';
import type { FlowId, GateId, PersonId } from './ids.ts';
import type { PieceKind } from './piece.ts';
import { PIECE_LABELS } from './piece.ts';
import { latestApproved, pendingReview, pieceOfKind } from './record.ts';
import type { ProductionRecord } from './record.ts';
import { isDelivered, PIECE_PARENTS, pieceStatus, productionStatus } from './rules/status.ts';
import type { PieceStatus, ProductionStatus } from './rules/status.ts';

/**
 * The production journey (Material · Artigo · Aprovação · Carrossel · Entrega) derived from a flow
 * definition and the record. This is the single source for the stepper, tabs and board.
 * States match the DS Stepper (`done | current | upcoming | warn | error | blocked`).
 *
 * A `gate` stage is the approval of a piece shown as its own step ("Aprovação"): when a flow has
 * one, the piece stage before it is complete once the text is sent, and the gate completes when
 * the piece is approved.
 */

export type StageKind = 'source' | 'piece' | 'gate' | 'delivery';

export type StageDefinition = {
  id: string;
  label: string;
  kind: StageKind;
  /** Piece stages: the piece written there. Gate stages: the piece the gate decides on. */
  pieceKind?: PieceKind;
  /** Gate stages: the gate that decides (`article.approval`). */
  gateId?: GateId;
};

export type FlowDefinition = {
  id: FlowId;
  label: string;
  stages: StageDefinition[];
};

/**
 * R1 flow (D3): Material → Artigo → Aprovação → Carrossel → Entrega. The article's approval is a
 * step of its own; the carousel's approval is a state inside Carrossel (its stage `detail`).
 */
export const R1_FLOW: FlowDefinition = {
  id: 'transcript-article',
  label: 'Transcrição → artigo e carrossel',
  stages: [
    { id: 'source', label: 'Material', kind: 'source' },
    { id: 'article', label: 'Artigo', kind: 'piece', pieceKind: 'article' },
    { id: 'approval', label: 'Aprovação', kind: 'gate', pieceKind: 'article', gateId: 'article.approval' },
    { id: 'carousel', label: 'Carrossel', kind: 'piece', pieceKind: 'carousel' },
    { id: 'delivery', label: 'Entrega', kind: 'delivery' },
  ],
};

export type StageState = 'done' | 'current' | 'upcoming' | 'warn' | 'error' | 'blocked';

export type StageView = {
  id: string;
  label: string;
  kind: StageKind;
  pieceKind?: PieceKind;
  state: StageState;
  /** Piece status for piece stages; `ready`/`completed`/`waiting` for source and delivery. */
  status: PieceStatus | 'ready' | 'waiting' | 'completed';
  /** pt-BR reason shown in the Tooltip of a blocked stage. */
  blockedReason?: string;
  /** Approval detail for the journey menu: "Com Pedro", "Aprovado", "Ajustes solicitados", "Aprovação desatualizada". */
  detail?: string;
  selectable: boolean;
};

export type StageStateOptions = {
  /** First name of a person ("Pedro") for "Com Pedro"; without it the detail reads "Aguardando aprovação". */
  nameOf?: (id: PersonId) => string;
};

export type JourneyView = {
  stages: StageView[];
  currentStageId: string;
  status: ProductionStatus;
};

type Evaluation = { complete: boolean; blockedReason?: string; flag?: 'warn' | 'error'; status: StageView['status']; detail?: string };

const FEMININE: readonly PieceKind[] = ['outline', 'webstory', 'newsletter'];

/** "o artigo", "o artigo e o carrossel". */
function joinLabels(kinds: readonly PieceKind[]): string {
  const labels = kinds.map((kind) => `${FEMININE.includes(kind) ? 'a' : 'o'} ${PIECE_LABELS[kind].toLowerCase()}`);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} e ${labels[labels.length - 1]}`;
}

function evaluateSource(record: ProductionRecord): Evaluation {
  if (record.sources.length === 0) return { complete: false, status: 'waiting' };
  const authorized = record.sources.every((source) => source.rights.authorized);
  return authorized ? { complete: true, status: 'ready' } : { complete: false, flag: 'warn', status: 'waiting' };
}

/** "Com Pedro" while a request waits (assignee named), else "Aguardando aprovação". */
function awaitingDetail(record: ProductionRecord, kind: PieceKind, options: StageStateOptions): string {
  const piece = pieceOfKind(record, kind);
  const request = piece ? pendingReview(record, piece.id) : undefined;
  return request?.assigneeId && options.nameOf ? `Com ${options.nameOf(request.assigneeId)}` : 'Aguardando aprovação';
}

/** The approval state of a piece in journey words (gate stages, and pieces whose gate has no stage). */
function approvalDetail(record: ProductionRecord, kind: PieceKind, status: PieceStatus, options: StageStateOptions): string | undefined {
  switch (status) {
    case 'in_review':
      return awaitingDetail(record, kind, options);
    case 'changes_requested':
      return 'Ajustes solicitados';
    case 'approved':
      return 'Aprovado';
    case 'approval_outdated':
      return 'Aprovação desatualizada';
    default:
      return undefined;
  }
}

/** Parent statuses with an approved version a derivative can be made from. */
const OPENS_DERIVATIVES: readonly PieceStatus[] = ['approved', 'stale', 'approval_outdated'];

/** Statuses after which a piece's own step is done when its approval is a separate stage. */
const SENT: readonly PieceStatus[] = ['in_review', 'approved', 'approval_outdated'];

function evaluatePiece(record: ProductionRecord, kind: PieceKind, gated: boolean, options: StageStateOptions): Evaluation {
  const status = pieceStatus(record, kind);
  const sourcesReady = record.sources.length > 0 && record.sources.every((source) => source.rights.authorized);
  const parents = (PIECE_PARENTS[kind] ?? []).filter((parent) => record.production.plan.includes(parent));
  // A parent edited after its approval still has an approved version to derive from.
  const blockedByParents = parents.filter((parent) => !OPENS_DERIVATIVES.includes(pieceStatus(record, parent)));
  let blockedReason: string | undefined;
  if (!sourcesReady && (status === 'not_started' || status === 'locked')) blockedReason = 'Disponível após autorizar o material.';
  else if (status === 'locked' || (blockedByParents.length > 0 && status === 'not_started')) {
    blockedReason = `Disponível após aprovar ${blockedByParents.length > 0 ? joinLabels(blockedByParents) : 'a etapa anterior'}.`;
  }
  const flag = status === 'failed' ? 'error' : status === 'stale' || status === 'changes_requested' ? 'warn' : undefined;
  const evaluation: Evaluation = { complete: gated ? SENT.includes(status) : status === 'approved', status };
  if (blockedReason) evaluation.blockedReason = blockedReason;
  if (flag) evaluation.flag = flag;
  // Without a gate stage of its own, the piece stage tells its approval state ("Com Pedro", "Aprovado").
  const detail = gated || !gateForPiece(kind) ? undefined : approvalDetail(record, kind, status, options);
  if (detail) evaluation.detail = detail;
  return evaluation;
}

/**
 * "Aprovação" of a piece: complete once approved (flagged when the text changed after it),
 * "Com Pedro" while waiting, "Ajustes solicitados" when returned, upcoming before the first send.
 */
function evaluateGate(record: ProductionRecord, kind: PieceKind, options: StageStateOptions): Evaluation {
  const status = pieceStatus(record, kind);
  const detail = approvalDetail(record, kind, status, options);
  const evaluation: Evaluation = { complete: status === 'approved' || status === 'approval_outdated', status };
  if (detail) evaluation.detail = detail;
  if (status === 'approval_outdated' || status === 'changes_requested') evaluation.flag = 'warn';
  // Blocked for the same reason as the piece it decides on (material not authorised, parent not approved).
  const { blockedReason } = evaluatePiece(record, kind, true, options);
  if (blockedReason) evaluation.blockedReason = blockedReason;
  return evaluation;
}

/**
 * Delivery opens once every planned piece has an approved version (REQ-1.6). A revision in
 * progress or a stale derivative does not close it: the delivery screen resolves the exact
 * package (`resolveExport`) and offers the consistent options.
 */
function evaluateDelivery(record: ProductionRecord): Evaluation {
  if (isDelivered(record)) return { complete: true, status: 'completed' };
  const pending = record.production.plan.filter((kind) => {
    const piece = pieceOfKind(record, kind);
    return !piece || latestApproved(record, piece.id) === undefined;
  });
  if (pending.length > 0) {
    return { complete: false, status: 'waiting', blockedReason: `Disponível após aprovar ${joinLabels(pending)}.` };
  }
  return { complete: false, status: 'ready' };
}

function evaluateStage(record: ProductionRecord, stage: StageDefinition, gatedKinds: ReadonlySet<PieceKind>, options: StageStateOptions): Evaluation {
  switch (stage.kind) {
    case 'source':
      return evaluateSource(record);
    case 'delivery':
      return evaluateDelivery(record);
    case 'gate':
      return evaluateGate(record, stage.pieceKind as PieceKind, options);
    case 'piece':
      return evaluatePiece(record, stage.pieceKind as PieceKind, gatedKinds.has(stage.pieceKind as PieceKind), options);
  }
}

export function stageState(record: ProductionRecord, flow: FlowDefinition = R1_FLOW, options: StageStateOptions = {}): JourneyView {
  const stages = flow.stages.filter(
    (stage) => (stage.kind !== 'piece' && stage.kind !== 'gate') || (stage.pieceKind && record.production.plan.includes(stage.pieceKind)),
  );
  const gatedKinds = new Set(stages.filter((stage) => stage.kind === 'gate' && stage.pieceKind).map((stage) => stage.pieceKind as PieceKind));
  const evaluations = stages.map((stage) => evaluateStage(record, stage, gatedKinds, options));
  const firstIncomplete = evaluations.findIndex((evaluation) => !evaluation.complete);
  const currentIndex = firstIncomplete < 0 ? stages.length - 1 : firstIncomplete;

  const views: StageView[] = stages.map((stage, index) => {
    const evaluation = evaluations[index];
    let state: StageState;
    if (index === currentIndex) state = 'current';
    else if (evaluation.flag) state = evaluation.flag;
    else if (evaluation.complete) state = 'done';
    else if (evaluation.blockedReason) state = 'blocked';
    else state = 'upcoming';
    const view: StageView = {
      id: stage.id,
      label: stage.label,
      kind: stage.kind,
      state,
      status: evaluation.status,
      selectable: state !== 'blocked',
    };
    if (stage.pieceKind) view.pieceKind = stage.pieceKind;
    if (evaluation.blockedReason && state === 'blocked') view.blockedReason = evaluation.blockedReason;
    if (evaluation.detail) view.detail = evaluation.detail;
    return view;
  });
  return { stages: views, currentStageId: stages[currentIndex].id, status: productionStatus(record) };
}
