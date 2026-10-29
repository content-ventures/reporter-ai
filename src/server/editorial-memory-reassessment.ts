import 'server-only';
import type { PoolClient } from 'pg';
import type { MemoryCheck, MemoryEvidence, MemoryMaterial, MemoryPolicy } from '../domain/editorial-memory.ts';
import type { MemoryPolicyReassessment, MemoryPolicyReassessmentInput } from '../domain/editorial-memory-reassessment.ts';
import { reassessMemoryPolicy } from '../domain/editorial-memory-reassessment.ts';
import { memoryIdSchema, memoryPolicyReassessmentSchema } from './editorial-memory-input.ts';
import { memoryCommand } from './editorial-memory-store.ts';
import { currentReporterContext } from './request-context.ts';
import { FlowError } from './errors.ts';

export type MemoryReassessmentContext = { evidence: MemoryEvidence; material: MemoryMaterial; check: MemoryCheck; policy: MemoryPolicy };
export async function memoryReassessmentContext(client: PoolClient, id: string, snapshot?: string): Promise<MemoryReassessmentContext | null> {
  return (await client.query('SELECT public.reporter_memory_reassessment_context($1,$2::bigint) AS value', [id, snapshot ?? null])).rows[0].value;
}
export function memoryReassessmentProof(context: MemoryReassessmentContext): MemoryPolicyReassessment {
  return { evidence: context.check.evidence, check: { id: context.check.id, revision: context.check.revision }, policyRevision: context.policy.revision,
    previousPolicyRevision: context.check.policyRevision, checkedAt: context.check.checkedAt };
}
export async function reassessEditorialMemory(id: string, value: MemoryPolicyReassessmentInput, requestId: string): Promise<MemoryCheck> {
  memoryIdSchema.parse(id); const input = memoryPolicyReassessmentSchema.parse(value);
  if (input.evidence.id !== id) throw new FlowError('INVALID_INPUT', 422);
  return memoryCommand('memory.check.reassess', { id, input }, requestId, 'library.edit', async client => {
    // Historical proof remains visible on a legitimate receipt replay; stale-write conditions apply only to new work.
    const visible = (await client.query('SELECT public.reporter_memory_calibration_access($1::jsonb,$2::jsonb,false,true) AS value', [JSON.stringify(input.evidence), JSON.stringify(input.check)])).rows[0].value;
    if (!visible) throw new FlowError('NOT_FOUND', 404);
  }, async client => {
    const context = await memoryReassessmentContext(client, id); if (!context) throw new FlowError('MEMORY_CONFLICT', 409);
    let document: MemoryCheck;
    try { document = reassessMemoryPolicy(context.evidence, context.material, context.check, context.policy, input,
      { actorId: currentReporterContext().actor, now: new Date().toISOString(), newId: () => id }); }
    catch (error) { const conflict = (error as Error).message === 'MEMORY_REASSESSMENT_CONFLICT'; throw new FlowError(conflict ? 'MEMORY_CONFLICT' : 'INVALID_INPUT', conflict ? 409 : 422); }
    return (await client.query('SELECT public.reporter_memory_reassess($1,$2::jsonb,$3::jsonb,$4,$5::jsonb,$6) AS value',
      [id, JSON.stringify(input.evidence), JSON.stringify(input.check), input.policyRevision, JSON.stringify(document), input.reason])).rows[0].value;
  });
}
