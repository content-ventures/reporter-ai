import { bodyHash } from '../piece.ts';
import type { Piece, PieceKind } from '../piece.ts';
import {
  activeRun,
  lastRun,
  latestApproved,
  latestDelivery,
  latestVersion,
  pendingReview,
  pieceDecisions,
  pieceOfKind,
  versionsOf,
} from '../record.ts';
import type { ProductionRecord } from '../record.ts';
import { sameVersionRef } from '../refs.ts';
import type { VersionRef } from '../refs.ts';
import { defaultExportSelection } from './export.ts';
import { pieceFreshness } from './freshness.ts';

/**
 * Derived status, never stored. One function for piece status and one for production status
 * feed tabs, list badges, the journey stepper and the board columns (fixes the duplicated
 * `stages` / `workflowSteps` lists of the prototype).
 */

export type PieceStatus =
  | 'locked'
  | 'not_started'
  | 'generating'
  | 'failed'
  | 'draft'
  | 'in_review'
  | 'changes_requested'
  | 'approved'
  | 'stale'
  /** Approved, then the draft changed: carousel and delivery keep using the approved version. */
  | 'approval_outdated';

export const PIECE_STATUS_LABELS: Record<PieceStatus, string> = {
  locked: 'Bloqueado',
  not_started: 'Não iniciado',
  generating: 'A IA está escrevendo',
  failed: 'Erro',
  draft: 'Rascunho',
  in_review: 'Aguardando aprovação',
  changes_requested: 'Ajustes solicitados',
  approved: 'Aprovado',
  stale: 'Desatualizado',
  approval_outdated: 'Aprovação desatualizada',
};

export type ProductionStatus =
  | 'draft'
  | 'unauthorized'
  | 'generating'
  | 'failed'
  | 'in_review'
  | 'changes_requested'
  | 'stale'
  | 'approved'
  | 'completed'
  | 'archived';

export const PRODUCTION_STATUS_LABELS: Record<ProductionStatus, string> = {
  draft: 'Rascunho',
  unauthorized: 'Falta autorização',
  generating: 'A IA está escrevendo',
  failed: 'Erro',
  in_review: 'Aguardando aprovação',
  changes_requested: 'Ajustes solicitados',
  stale: 'Desatualizado',
  approved: 'Aprovada',
  completed: 'Concluída',
  archived: 'Arquivada',
};

/**
 * Default order of "Produções" and of the queues (lower = more urgent): what stopped or waits for
 * a person first, finished work last.
 */
export const STATUS_URGENCY: Record<ProductionStatus, number> = {
  failed: 0,
  changes_requested: 1,
  in_review: 2,
  unauthorized: 3,
  stale: 4,
  generating: 5,
  draft: 6,
  approved: 7,
  completed: 8,
  archived: 9,
};

/** List tabs: Todas · Em edição · Aguardando aprovação · Ajustes solicitados · Aprovadas · Concluídas. */
export type ProductionTab = 'editing' | 'in_review' | 'changes_requested' | 'approved' | 'completed' | 'archived';

export function productionTab(status: ProductionStatus): ProductionTab {
  switch (status) {
    case 'in_review':
    case 'changes_requested':
    case 'approved':
    case 'completed':
    case 'archived':
      return status;
    default:
      return 'editing';
  }
}

/** Parent piece kinds a derivative needs approved first (R1: carousel ← article). */
export const PIECE_PARENTS: Partial<Record<PieceKind, PieceKind[]>> = {
  carousel: ['article'],
  stories: ['carousel'],
  cut: ['article'],
  newsletter: ['article'],
  post: ['article'],
};

export function parentsApproved(record: ProductionRecord, kind: PieceKind): boolean {
  return (PIECE_PARENTS[kind] ?? [])
    .filter((parent) => record.production.plan.includes(parent))
    .every((parent) => {
      const piece = pieceOfKind(record, parent);
      return piece !== undefined && latestApproved(record, piece.id) !== undefined;
    });
}

/**
 * True while the piece still shows exactly what a FAILED generation left (its finished
 * sections, "v1 · interrompida"): the failure is the piece's state until the person retries,
 * edits or restores. A run the person stopped ("Parar") or a reload interrupted is not a failure.
 */
function failedOutputUntouched(record: ProductionRecord, piece: Piece, hasDraftContent: boolean): boolean {
  const run = lastRun(record, piece.id);
  if (run?.status !== 'failed') return false;
  if (!hasDraftContent) return true;
  const output = run.output ? versionsOf(record, piece.id).find((version) => version.id === run.output?.versionId) : undefined;
  if (!output || output.hash !== bodyHash(piece.draft.body)) return false;
  return latestVersion(record, piece.id)?.id === output.id;
}

export function pieceStatus(record: ProductionRecord, kind: PieceKind): PieceStatus {
  const piece = pieceOfKind(record, kind);
  if (!piece) return parentsApproved(record, kind) ? 'not_started' : 'locked';
  if (activeRun(record, piece.id)) return 'generating';

  const versions = versionsOf(record, piece.id);
  const hasDraftContent = piece.draft.body.type === 'article' ? piece.draft.body.blocks.length > 0 : piece.draft.body.slides.length > 0;
  if (versions.length === 0) {
    const run = lastRun(record, piece.id);
    if (run && (run.status === 'failed' || run.status === 'cancelled') && !hasDraftContent) return 'failed';
    if (!hasDraftContent) return parentsApproved(record, kind) ? 'not_started' : 'locked';
    return 'draft';
  }

  if (pendingReview(record, piece.id)) return 'in_review';
  if (failedOutputUntouched(record, piece, hasDraftContent)) return 'failed';
  const stale = pieceFreshness(record, piece.id).state === 'stale';
  const decisions = pieceDecisions(record, piece.id);
  const last = decisions[decisions.length - 1];
  if (last?.decision === 'changes_requested' || last?.decision === 'rejected') return 'changes_requested';
  if (stale) return 'stale';
  const approved = latestApproved(record, piece.id);
  if (!approved) return 'draft';
  // Edited after the approval: the approval stays (carousel and delivery use it) but asks to resend.
  if (last?.decision === 'approved' && bodyHash(piece.draft.body) !== approved.version.hash) return 'approval_outdated';
  return 'approved';
}

/** True when the latest completed delivery shipped exactly the current approved versions. */
export function isDelivered(record: ProductionRecord): boolean {
  const delivery = latestDelivery(record);
  if (!delivery || delivery.status !== 'completed') return false;
  const current = defaultExportSelection(record);
  return current.every((ref) => delivery.items.some((item) => sameVersionRef(item.version, ref)));
}

export function productionStatus(record: ProductionRecord): ProductionStatus {
  if (record.production.archivedAt) return 'archived';
  const statuses = record.production.plan.map((kind) => pieceStatus(record, kind));
  if (statuses.includes('generating')) return 'generating';
  // Nothing can be generated until the material is authorised (REQ-T.1): a red "Falta", not a draft.
  if (record.sources.some((source) => !source.rights.authorized)) return 'unauthorized';
  const allApproved = statuses.every((status) => status === 'approved');
  if (allApproved) return isDelivered(record) ? 'completed' : 'approved';
  const current = statuses.find((status) => status !== 'approved');
  switch (current) {
    case 'in_review':
    case 'changes_requested':
    case 'failed':
    case 'stale':
      return current;
    case 'approval_outdated':
      return 'stale';
    default:
      return 'draft';
  }
}

/** Version refs currently shipped, for "Concluída" badges and the delivery screen. */
export function deliveredRefs(record: ProductionRecord): VersionRef[] {
  const delivery = latestDelivery(record);
  return delivery?.status === 'completed' ? delivery.items.map((item) => item.version) : [];
}

