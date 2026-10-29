import type { MemoryPolicy } from './editorial-memory.ts';
import type { MemoryCalibrationCase, MemoryEvaluationCriteria, MemoryPolicyEvaluation, MemoryPolicySettings } from './editorial-memory-calibration.ts';
import { evaluateMemoryPolicy } from './editorial-memory-calibration.ts';
import type { CommandContext } from './result.ts';

export type MemoryPolicyProposalInput = { baseRevision: number; settings: MemoryPolicySettings; criteria: MemoryEvaluationCriteria | null;
  cases: { id: string; split: 'training' | 'validation' }[]; reason: string };
export type MemoryPolicyProposal = MemoryPolicyProposalInput & { id: string; workspaceId: string; baseline: MemoryPolicy; evaluation: MemoryPolicyEvaluation;
  restoredFrom: number | null; createdBy: string; createdAt: string };
export function proposeMemoryPolicy(input: MemoryPolicyProposalInput, cases: MemoryCalibrationCase[], baseline: MemoryPolicy, restoredFrom: number | null, ctx: CommandContext): MemoryPolicyProposal {
  if (input.baseRevision !== baseline.revision || input.cases.length !== cases.length || !input.reason.trim()) throw new Error('MEMORY_POLICY_CONFLICT');
  const dataset = input.cases.map(ref => { const item = cases.find(item => item.id === ref.id); if (!item) throw new Error('MEMORY_CALIBRATION_DATASET_INVALID'); return { item, split: ref.split }; });
  return { ...structuredClone(input), reason: input.reason.trim(), id: ctx.newId('memory-policy-proposal'), workspaceId: baseline.workspaceId,
    baseline: structuredClone(baseline), evaluation: evaluateMemoryPolicy(dataset, baseline, input.settings, input.criteria), restoredFrom, createdBy: ctx.actorId, createdAt: ctx.now };
}
export function activateMemoryPolicy(proposal: MemoryPolicyProposal, current: MemoryPolicy, reason: string, ctx: CommandContext): MemoryPolicy {
  if (proposal.workspaceId !== current.workspaceId || proposal.baseRevision !== current.revision) throw new Error('MEMORY_POLICY_CONFLICT');
  if (!proposal.evaluation.activatable || !reason.trim()) throw new Error('MEMORY_POLICY_NOT_EVALUATED');
  const calibrated = proposal.settings.mode === 'calibrated';
  return { id: current.id, workspaceId: current.workspaceId, revision: current.revision + 1, ...structuredClone(proposal.settings),
    calibrationReportId: calibrated ? proposal.id : null, ...(calibrated ? { calibration: structuredClone(proposal.evaluation.calibration) } : {}),
    activatedAt: ctx.now, activatedBy: ctx.actorId, change: { proposalId: proposal.id, previousRevision: current.revision, restoredFrom: proposal.restoredFrom, reason: reason.trim() } };
}
