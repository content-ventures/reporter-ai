import type { DecisionId } from '../ids.ts';
import { PIECE_LABELS, toVersionRef } from '../piece.ts';
import type { PieceKind } from '../piece.ts';
import { findVersion, latestApproved, latestDecisionOn } from '../record.ts';
import type { ProductionRecord } from '../record.ts';
import { sameVersionRef } from '../refs.ts';
import type { VersionRef } from '../refs.ts';
import { ok, refuse } from '../result.ts';
import type { Result } from '../result.ts';

/**
 * REQ-1.6: export article and carousel "da versão correta". Every item must carry an approval
 * on its exact version, and every derivative must have been made FROM the exact parent version
 * in the package; mixing article v5 with a carousel written from v4 is refused with options.
 */

export type ExportRefusal = 'nothing_to_export' | 'missing_piece' | 'unknown_version' | 'not_approved' | 'mixed_versions';

export type ExportItem = { kind: PieceKind; version: VersionRef; decisionId: DecisionId };

export type MixedVersionsDetails = {
  derivative: VersionRef;
  parentInPackage: VersionRef;
  derivedFrom: VersionRef;
  /** Selection that exports the parent version the derivative was made from, when approved. */
  exportWithParent?: VersionRef[];
};

type ExportRecord = Pick<ProductionRecord, 'production' | 'pieces' | 'versions' | 'decisions'>;

export function canExport(record: ExportRecord, selection: readonly VersionRef[]): Result<ExportItem[], ExportRefusal> {
  if (selection.length === 0) return refuse('nothing_to_export', 'Nada para exportar.');

  const items: ExportItem[] = [];
  for (const ref of selection) {
    const version = findVersion(record, ref.versionId);
    const piece = record.pieces.find((candidate) => candidate.id === ref.pieceId);
    if (!version || !piece || version.pieceId !== ref.pieceId || version.hash !== ref.hash) {
      return refuse('unknown_version', 'Uma das versões do pacote não existe mais.');
    }
    const decision = latestDecisionOn(record, ref);
    if (decision?.decision !== 'approved') {
      return refuse('not_approved', `Falta aprovar o ${PIECE_LABELS[piece.kind].toLowerCase()}.`, { version: ref });
    }
    items.push({ kind: piece.kind, version: ref, decisionId: decision.id });
  }

  for (const kind of record.production.plan) {
    if (!items.some((item) => item.kind === kind)) {
      return refuse('missing_piece', `Aprove ${PIECE_LABELS[kind].toLowerCase()} antes de exportar.`, { kind });
    }
  }

  for (const item of items) {
    const version = findVersion(record, item.version.versionId);
    for (const input of version?.inputs ?? []) {
      const parent = items.find((candidate) => candidate.version.pieceId === input.pieceId);
      if (!parent || sameVersionRef(parent.version, input)) continue;
      const details: MixedVersionsDetails = { derivative: item.version, parentInPackage: parent.version, derivedFrom: input };
      if (latestDecisionOn(record, input)?.decision === 'approved') {
        details.exportWithParent = selection.map((ref) => (ref.pieceId === input.pieceId ? input : ref));
      }
      return refuse(
        'mixed_versions',
        `O ${PIECE_LABELS[item.kind].toLowerCase()} foi feito a partir de uma versão anterior do ${PIECE_LABELS[parent.kind].toLowerCase()}.`,
        details,
      );
    }
  }
  return ok(items);
}

/** Default package: the latest approved version of each planned piece. */
export function defaultExportSelection(record: ExportRecord): VersionRef[] {
  const selection: VersionRef[] = [];
  for (const kind of record.production.plan) {
    const piece = record.pieces.find((candidate) => candidate.kind === kind);
    const approved = piece ? latestApproved(record, piece.id) : undefined;
    if (approved) selection.push(toVersionRef(approved.version));
  }
  return selection;
}

export type ExportResolution = {
  selection: VersionRef[];
  result: Result<ExportItem[], ExportRefusal>;
};

/** Validates the default package; on mixed versions the refusal carries `exportWithParent`. */
export function resolveExport(record: ExportRecord): ExportResolution {
  const selection = defaultExportSelection(record);
  return { selection, result: canExport(record, selection) };
}
