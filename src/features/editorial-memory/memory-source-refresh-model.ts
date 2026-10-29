import { memoryDecisionApplies, memoryEvidenceRef, sameMemoryEvidence, type MemorySelection } from '../../domain/editorial-memory.ts';
import type { MemoryDetail } from '../../ports/editorial-memory.ts';
import { contentHash } from '../../domain/text/hash.ts';

export type RefreshItem = MemorySelection['items'][number];
export function currentRefreshItem(detail: MemoryDetail, previous?: RefreshItem): RefreshItem {
  return { evidence: memoryEvidenceRef(detail.evidence), check: detail.check ? { id: detail.check.id, revision: detail.check.revision } : null,
    ...(previous?.evidence.id === detail.evidence.id && previous.discovery ? { discovery: structuredClone(previous.discovery) } : {}),
    decisionId: memoryDecisionApplies(detail.evidence, detail.policy, detail.check, detail.decision) ? detail.decision!.id : null, policyRevision: detail.policy.revision };
}
export function sameRefreshItem(a: RefreshItem, b: RefreshItem): boolean {
  return sameMemoryEvidence(a.evidence, b.evidence) && a.decisionId === b.decisionId && a.policyRevision === b.policyRevision
    && contentHash(a.discovery ?? null) === contentHash(b.discovery ?? null)
    && (a.check?.id ?? null) === (b.check?.id ?? null) && (a.check?.revision ?? null) === (b.check?.revision ?? null);
}
