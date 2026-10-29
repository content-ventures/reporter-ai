import 'server-only';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { MemoryCalibrationCase, MemoryCalibrationCaseInput } from '../domain/editorial-memory-calibration.ts';
import { MEMORY_CALIBRATION_VERSION, memoryCalibrationBin, memoryCalibrationGroups } from '../domain/editorial-memory-calibration.ts';
import type { MemoryPolicyProposal, MemoryPolicyProposalInput } from '../domain/editorial-memory-policy.ts';
import { activateMemoryPolicy, proposeMemoryPolicy } from '../domain/editorial-memory-policy.ts';
import { initialMemoryPolicy, memoryEvidenceRef, sameMemoryEvidence, type MemoryPage, type MemoryPolicy } from '../domain/editorial-memory.ts';
import { can } from '../domain/permissions.ts';
import type { MemoryHistoryQuery } from '../ports/editorial-memory.ts';
import { memoryCalibrationCaseSchema, memoryHistoryQuerySchema, memoryIdSchema, memoryPolicyActivationSchema, memoryPolicyProposalSchema, memoryPolicyRestoreSchema } from './editorial-memory-input.ts';
import { memoryCommand, memoryGet, memoryRead } from './editorial-memory-store.ts';
import { memoryBundle, memoryReadState } from './editorial-memory-detail.ts';
import type { MemoryBundle } from './editorial-memory-query.ts';
import { memoryCursorKey } from './editorial-memory-query.ts';
import { decodeMemoryCursor, encodeMemoryCursor } from './editorial-memory-cursor.ts';
import { currentReporterContext } from './request-context.ts';
import { FlowError, forbiddenError } from './errors.ts';
type Kind = 'case' | 'proposal' | 'version';
function admin() { const context = currentReporterContext(); if (context.view || !can(context.roles, 'pipeline.edit')) throw forbiddenError('pipeline.edit'); }
const commandContext = () => ({ actorId: currentReporterContext().actor, now: new Date().toISOString(), newId: (prefix: string) => `${prefix}-${randomUUID()}` });
const active = async (client: PoolClient) => (await memoryGet<MemoryPolicy>(client, 'policy', 'editorial-memory'))?.doc ?? initialMemoryPolicy(currentReporterContext().portal);
async function record<T>(client: PoolClient, kind: Kind, id: string): Promise<T> {
  const result = (await client.query('SELECT public.reporter_memory_policy_record($1,$2) AS value', [kind, id])).rows[0].value;
  if (!result) throw new FlowError('NOT_FOUND', 404); return result;
}
async function accessible(client: PoolClient, item: Pick<MemoryCalibrationCase, 'evidence' | 'check'>, authorized = false) {
  if (!(await client.query('SELECT public.reporter_memory_calibration_access($1::jsonb,$2::jsonb,false,$3) AS value', [JSON.stringify(item.evidence), JSON.stringify(item.check), authorized])).rows[0].value) throw new FlowError('NOT_FOUND', 404);
}
export async function readMemoryPolicyRecords<T>(kind: Kind, value: MemoryHistoryQuery): Promise<MemoryPage<T>> {
  if (kind !== 'case') admin(); const input = memoryHistoryQuerySchema.parse(value), context = currentReporterContext(), key = memoryCursorKey();
  return memoryRead(async client => {
    const state = await memoryReadState(client), binding = { tenant: context.tenant, workspace: context.portal, actor: context.actor, visibility: state.visibility };
    const identity = { resource: 'policy-records' as const, kind, limit: input.limit }, cursor = input.cursor ? decodeMemoryCursor(input.cursor, identity, binding, key, Date.now()) : null;
    if (cursor && !/^(?:0|[1-9]\d{0,18})$/.test(cursor.position.key)) throw new FlowError('MEMORY_CURSOR_INVALID', 409);
    const result = (await client.query('SELECT public.reporter_memory_policy_page($1,$2::bigint,$3::bigint,$4,$5) AS value', [kind, cursor?.snapshot ?? state.snapshot, cursor?.position.key ?? null, input.limit, state.visibility])).rows[0].value;
    return { items: result.items, total: result.total, snapshot: result.snapshot, nextCursor: result.next ? encodeMemoryCursor({ snapshot: result.snapshot, position: result.next }, identity, binding, key, Date.now()) : null };
  });
}
export async function readMemoryPolicyProposal(id: string): Promise<MemoryPolicyProposal> { admin(); memoryIdSchema.parse(id); return memoryRead(client => record(client, 'proposal', id)); }
export async function annotateMemoryCalibration(value: MemoryCalibrationCaseInput, requestId: string): Promise<MemoryCalibrationCase> {
  const input = memoryCalibrationCaseSchema.parse(value); let bundle: MemoryBundle;
  return memoryCommand('memory.calibration.case', input, requestId, 'library.review', async client => {
    await accessible(client, input); bundle = await memoryBundle(client, input.evidence.id, await memoryReadState(client));
  }, async client => {
    if (!bundle.source || !bundle.check || bundle.checkState !== 'current' || !sameMemoryEvidence(input.evidence, memoryEvidenceRef(bundle.evidence))
      || bundle.check.id !== input.check.id || bundle.check.revision !== input.check.revision) throw new FlowError('MEMORY_CONFLICT', 409);
    const context = commandContext(), document: MemoryCalibrationCase = { ...input, id: context.newId('memory-calibration-case'), workspaceId: bundle.evidence.workspaceId,
      version: MEMORY_CALIBRATION_VERSION, policyRevision: bundle.check.policyRevision, source: bundle.evidence.anchor.source, materialId: bundle.material.id, primaryOrigin: bundle.material.primaryOrigin,
      excerpt: bundle.evidence.anchor.excerpt, materialTitle: bundle.material.title, groups: memoryCalibrationGroups(bundle.evidence, bundle.material, bundle.check), kinds: bundle.evidence.kinds, bin: memoryCalibrationBin(bundle.evidence, bundle.material, bundle.check), structurallyUsable: false, personId: context.actorId, at: context.now };
    return (await client.query('SELECT public.reporter_memory_calibration_save($1::jsonb) AS value', [JSON.stringify(document)])).rows[0].value;
  });
}
export async function proposeEditorialMemoryPolicy(value: MemoryPolicyProposalInput | { baseRevision: number; targetRevision: number; reason: string }, requestId: string, restore = false): Promise<MemoryPolicyProposal> {
  admin(); const input = restore ? memoryPolicyRestoreSchema.parse(value) : memoryPolicyProposalSchema.parse(value);
  let cases: MemoryCalibrationCase[] = [], proposalInput: MemoryPolicyProposalInput;
  return memoryCommand(restore ? 'memory.policy.restore' : 'memory.policy.propose', input, requestId, 'pipeline.edit', async client => {
    if ('targetRevision' in input) {
      const target = await record<MemoryPolicy>(client, 'version', String(input.targetRevision));
      const original = target.mode === 'calibrated' && target.calibrationReportId ? await record<MemoryPolicyProposal>(client, 'proposal', target.calibrationReportId) : null;
      proposalInput = { baseRevision: input.baseRevision, settings: { mode: target.mode, thresholds: target.thresholds }, criteria: original?.criteria ?? null, cases: original?.cases ?? [], reason: input.reason };
    } else proposalInput = input;
    cases = []; for (const ref of proposalInput.cases) { const item = await record<MemoryCalibrationCase>(client, 'case', ref.id); await accessible(client, item); cases.push(item); }
  }, async client => {
    let proposal: MemoryPolicyProposal;
    try { proposal = proposeMemoryPolicy(proposalInput, cases, await active(client), 'targetRevision' in input ? input.targetRevision : null, commandContext()); }
    catch (error) { throw new FlowError((error as Error).message === 'MEMORY_POLICY_CONFLICT' ? 'MEMORY_CONFLICT' : 'INVALID_INPUT', (error as Error).message === 'MEMORY_POLICY_CONFLICT' ? 409 : 422); }
    return (await client.query('SELECT public.reporter_memory_policy_propose($1::jsonb) AS value', [JSON.stringify(proposal)])).rows[0].value;
  });
}
export async function activateEditorialMemoryPolicy(id: string, value: { baseRevision: number; reason: string }, requestId: string): Promise<MemoryPolicy> {
  admin(); memoryIdSchema.parse(id); const input = memoryPolicyActivationSchema.parse(value); let proposal: MemoryPolicyProposal;
  return memoryCommand('memory.policy.activate', { id, input }, requestId, 'pipeline.edit', async client => {
    proposal = await record(client, 'proposal', id); for (const ref of proposal.cases) await accessible(client, await record(client, 'case', ref.id));
  }, async client => {
    const current = await active(client); if (input.baseRevision !== current.revision) throw new FlowError('MEMORY_CONFLICT', 409);
    try { activateMemoryPolicy(proposal, current, input.reason, commandContext()); }
    catch (error) { throw new FlowError((error as Error).message === 'MEMORY_POLICY_CONFLICT' ? 'MEMORY_CONFLICT' : 'INVALID_INPUT', (error as Error).message === 'MEMORY_POLICY_CONFLICT' ? 409 : 422); }
    return (await client.query('SELECT public.reporter_memory_policy_activate($1,$2,$3) AS value', [id, input.baseRevision, input.reason])).rows[0].value;
  });
}
