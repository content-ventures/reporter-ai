import type { Decision } from '../decision.ts';
import { findVersion, latestApproved, latestDecisionOn } from '../record.ts';
import type { ProductionRecord } from '../record.ts';
import type { VersionRef } from '../refs.ts';
import { ok, refuse } from '../result.ts';
import type { Result } from '../result.ts';

/**
 * REQ-1.3 / REQ-T.6: a derivative (carousel, later cut, stories, newsletter…) may only be
 * produced from a parent version that has an approved decision on that EXACT version ref
 * (same id and same content hash), and only from the most recently approved one.
 */

export type DeriveRefusal = 'unknown_version' | 'hash_mismatch' | 'parent_not_approved' | 'superseded';

export function canDerive(
  record: Pick<ProductionRecord, 'versions' | 'decisions'>,
  parent: VersionRef,
): Result<{ parent: VersionRef; decision: Decision }, DeriveRefusal> {
  const version = findVersion(record, parent.versionId);
  if (!version || version.pieceId !== parent.pieceId) {
    return refuse('unknown_version', 'Versão de origem não encontrada.');
  }
  if (version.hash !== parent.hash) {
    return refuse('hash_mismatch', 'A versão de origem mudou desde a aprovação.', { expected: version.hash, received: parent.hash });
  }
  const decision = latestDecisionOn(record, parent);
  if (decision?.decision !== 'approved') {
    return refuse('parent_not_approved', `Disponível após aprovar a versão ${parent.number}.`);
  }
  const latest = latestApproved(record, parent.pieceId);
  if (latest && latest.version.id !== parent.versionId) {
    return refuse('superseded', `Existe uma versão aprovada mais recente (v${latest.version.number}).`, {
      latestVersionId: latest.version.id,
      latestNumber: latest.version.number,
    });
  }
  return ok({ parent, decision });
}
