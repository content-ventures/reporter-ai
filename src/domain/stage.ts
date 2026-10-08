import type { FlowId } from './ids.ts';
import type { PieceKind } from './piece.ts';
import { PIECE_LABELS } from './piece.ts';
import { latestApproved, pieceOfKind } from './record.ts';
import type { ProductionRecord } from './record.ts';
import { isDelivered, PIECE_PARENTS, pieceStatus, productionStatus } from './rules/status.ts';
import type { PieceStatus, ProductionStatus } from './rules/status.ts';

/**
 * The production journey (Material · Artigo · Carrossel · Entrega) derived from a flow
 * definition and the record. This is the single source for the stepper, tabs and board.
 * States match the DS Stepper (`done | current | upcoming | warn | error | blocked`).
 */

export type StageKind = 'source' | 'piece' | 'delivery';

export type StageDefinition = {
  id: string;
  label: string;
  kind: StageKind;
  pieceKind?: PieceKind;
};

export type FlowDefinition = {
  id: FlowId;
  label: string;
  stages: StageDefinition[];
};

/** R1 flow: authorised transcript → article → (gate) → carousel → (gate) → export. */
export const R1_FLOW: FlowDefinition = {
  id: 'transcript-article',
  label: 'Transcrição → artigo e carrossel',
  stages: [
    { id: 'source', label: 'Material', kind: 'source' },
    { id: 'article', label: 'Artigo', kind: 'piece', pieceKind: 'article' },
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
  selectable: boolean;
};

export type JourneyView = {
  stages: StageView[];
  currentStageId: string;
  status: ProductionStatus;
};

type Evaluation = { complete: boolean; blockedReason?: string; flag?: 'warn' | 'error'; status: StageView['status'] };

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

function evaluatePiece(record: ProductionRecord, kind: PieceKind): Evaluation {
  const status = pieceStatus(record, kind);
  const sourcesReady = record.sources.length > 0 && record.sources.every((source) => source.rights.authorized);
  const parents = (PIECE_PARENTS[kind] ?? []).filter((parent) => record.production.plan.includes(parent));
  const blockedByParents = parents.filter((parent) => {
    const parentStatus = pieceStatus(record, parent);
    return parentStatus !== 'approved' && parentStatus !== 'stale';
  });
  let blockedReason: string | undefined;
  if (!sourcesReady && (status === 'not_started' || status === 'locked')) blockedReason = 'Disponível após autorizar o material.';
  else if (status === 'locked' || (blockedByParents.length > 0 && status === 'not_started')) {
    blockedReason = `Disponível após aprovar ${blockedByParents.length > 0 ? joinLabels(blockedByParents) : 'a etapa anterior'}.`;
  }
  const flag = status === 'failed' ? 'error' : status === 'stale' || status === 'changes_requested' ? 'warn' : undefined;
  const evaluation: Evaluation = { complete: status === 'approved', status };
  if (blockedReason) evaluation.blockedReason = blockedReason;
  if (flag) evaluation.flag = flag;
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

export function stageState(record: ProductionRecord, flow: FlowDefinition = R1_FLOW): JourneyView {
  const stages = flow.stages.filter((stage) => stage.kind !== 'piece' || (stage.pieceKind && record.production.plan.includes(stage.pieceKind)));
  const evaluations = stages.map((stage) => {
    if (stage.kind === 'source') return evaluateSource(record);
    if (stage.kind === 'delivery') return evaluateDelivery(record);
    return evaluatePiece(record, stage.pieceKind as PieceKind);
  });
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
    return view;
  });
  return { stages: views, currentStageId: stages[currentIndex].id, status: productionStatus(record) };
}
