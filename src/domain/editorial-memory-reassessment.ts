import type { MemoryCheck, MemoryCheckRef, MemoryEvidence, MemoryEvidenceRef, MemoryMaterial, MemoryPolicy } from './editorial-memory.ts';
import { memoryEvidenceRef, sameMemoryEvidence } from './editorial-memory.ts';
import { memoryCalibrationBin, memoryCalibratedConfidence } from './editorial-memory-calibration.ts';
import { contentHash } from './text/hash.ts';
import type { CommandContext } from './result.ts';

export type MemoryPolicyReassessmentInput = { evidence: MemoryEvidenceRef; check: MemoryCheckRef; policyRevision: number; reason: string };
export type MemoryPolicyReassessment = Omit<MemoryPolicyReassessmentInput, 'reason'> & { previousPolicyRevision: number; checkedAt: string };
/** Persistence must independently revalidate source rights, support revisions and absence of active check work. */
export function reassessMemoryPolicy(evidence: MemoryEvidence, material: MemoryMaterial, previous: MemoryCheck, policy: MemoryPolicy,
  input: MemoryPolicyReassessmentInput, ctx: CommandContext): MemoryCheck {
  if (evidence.workspaceId !== policy.workspaceId || material.workspaceId !== policy.workspaceId || previous.workspaceId !== policy.workspaceId
    || previous.id !== evidence.id || evidence.materialId !== material.id || evidence.status !== 'active'
    || !sameMemoryEvidence(input.evidence, memoryEvidenceRef(evidence)) || !sameMemoryEvidence(previous.evidence, input.evidence)
    || input.check.id !== previous.id || input.check.revision !== previous.revision || input.policyRevision !== policy.revision
    || !Number.isInteger(previous.policyRevision) || previous.policyRevision < 1 || previous.policyRevision >= policy.revision
    || contentHash(material.source) !== contentHash(evidence.anchor.source)) throw new Error('MEMORY_REASSESSMENT_CONFLICT');
  const reason = input.reason.trim(); if (!reason || reason.length > 2000) throw new Error('MEMORY_REASSESSMENT_REASON_REQUIRED');
  return { ...structuredClone(previous), revision: previous.revision + 1, policyRevision: policy.revision,
    confidence: policy.mode === 'calibrated' && policy.calibrationReportId ? memoryCalibratedConfidence(memoryCalibrationBin(evidence, material, previous), policy.calibration) : null,
    policyEvaluation: { check: { id: previous.id, revision: previous.revision }, previousPolicyRevision: previous.policyRevision,
      personId: ctx.actorId, at: ctx.now, reason } };
}
