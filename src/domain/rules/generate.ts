import type { PieceKind } from '../piece.ts';
import { PIECE_LABELS } from '../piece.ts';
import { toBriefRef } from '../production.ts';
import { anyRunActive, currentSourceRefs, latestApproved, pieceOfKind } from '../record.ts';
import type { ProductionRecord } from '../record.ts';
import type { Ref, VersionRef } from '../refs.ts';
import { ok, refuse } from '../result.ts';
import type { Result } from '../result.ts';
import { canDerive } from './derive.ts';
import { PIECE_PARENTS } from './status.ts';

/**
 * May a generation start for this piece? The answer also returns the run CONTEXT to record
 * (REQ-1.2: source version + brief snapshot + approved parent), so every adapter stores the
 * same inputs. R1 is "transcrição autorizada": unauthorised material never reaches the model.
 */

export type GenerateRefusal = 'not_planned' | 'source_missing' | 'source_not_authorized' | 'run_in_progress' | 'parent_not_ready';

export type GenerationContext = {
  /** Inputs to store on the run (and to carry into the resulting version). */
  inputs: Ref[];
  /** Approved parent versions for derivatives (carousel ← article vN). */
  parents: VersionRef[];
};

export function canGenerate(record: ProductionRecord, kind: PieceKind): Result<GenerationContext, GenerateRefusal> {
  if (!record.production.plan.includes(kind)) {
    return refuse('not_planned', `${PIECE_LABELS[kind]} não faz parte desta produção.`);
  }
  if (record.sources.length === 0) return refuse('source_missing', 'Adicione o material antes de gerar.');
  if (record.sources.some((source) => !source.rights.authorized)) {
    return refuse('source_not_authorized', 'Confirme que o material está autorizado para gerar.');
  }
  const piece = pieceOfKind(record, kind);
  if (piece && anyRunActive(record, piece.id)) return refuse('run_in_progress', 'Já existe uma geração em andamento.');

  const parents: VersionRef[] = [];
  for (const parentKind of PIECE_PARENTS[kind] ?? []) {
    if (!record.production.plan.includes(parentKind)) continue;
    const parentPiece = pieceOfKind(record, parentKind);
    const approved = parentPiece ? latestApproved(record, parentPiece.id) : undefined;
    if (!approved) {
      return refuse('parent_not_ready', `Disponível após aprovar ${PIECE_LABELS[parentKind].toLowerCase()}.`, { parentKind });
    }
    const derivable = canDerive(record, approved.ref);
    if (!derivable.ok) return refuse('parent_not_ready', derivable.refusal.message, { parentKind });
    parents.push(approved.ref);
  }

  return ok({ inputs: [...currentSourceRefs(record), toBriefRef(record.production), ...parents], parents });
}
