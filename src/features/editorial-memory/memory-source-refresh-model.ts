import { memoryDecisionApplies, memoryEvidenceRef, sameMemoryEvidence, type MemorySelection } from '../../domain/editorial-memory.ts';
import type { MemoryDetail } from '../../ports/editorial-memory.ts';

export type RefreshItem = MemorySelection['items'][number];
export function currentRefreshItem(detail: MemoryDetail): RefreshItem {
  return { evidence: memoryEvidenceRef(detail.evidence), check: detail.check ? { id: detail.check.id, revision: detail.check.revision } : null,
    decisionId: memoryDecisionApplies(detail.evidence, detail.policy, detail.check, detail.decision) ? detail.decision!.id : null, policyRevision: detail.policy.revision };
}
export function sameRefreshItem(a: RefreshItem, b: RefreshItem): boolean {
  return sameMemoryEvidence(a.evidence, b.evidence) && a.decisionId === b.decisionId && a.policyRevision === b.policyRevision
    && (a.check?.id ?? null) === (b.check?.id ?? null) && (a.check?.revision ?? null) === (b.check?.revision ?? null);
}
