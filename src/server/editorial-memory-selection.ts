import 'server-only';
import { randomUUID } from 'node:crypto';
import type { MemoryEvidenceRef, MemoryPage, MemorySelection } from '../domain/editorial-memory.ts';
import type { MemoryHistoryQuery } from '../ports/editorial-memory.ts';
import { initialMemoryPolicy, memoryDecisionApplies, memoryEvidenceRef, sameMemoryEvidence } from '../domain/editorial-memory.ts';
import { memoryHistoryQuerySchema, memoryIdSchema, memorySelectionInputSchema } from './editorial-memory-input.ts';
import { decodeMemoryCursor, encodeMemoryCursor } from './editorial-memory-cursor.ts';
import { memoryBundle, memoryReadState } from './editorial-memory-detail.ts';
import { memoryCursorKey, memoryView } from './editorial-memory-query.ts';
import type { MemoryBundle } from './editorial-memory-query.ts';
import { memoryCommand, memoryGet, memoryRead } from './editorial-memory-store.ts';
import { currentReporterContext } from './request-context.ts';
import { FlowError } from './errors.ts';

type Input = { id?: string; baseRevision: number; productionId: string | null; evidence: MemoryEvidenceRef[] };
export async function selectEditorialMemory(value: Input, requestId: string): Promise<MemorySelection> {
  const input = memorySelectionInputSchema.parse(value), context = currentReporterContext();
  let bundles: MemoryBundle[];
  return memoryCommand('memory.selection.save', input, requestId, 'library.edit', async client => {
    await client.query('SELECT public.reporter_memory_selection_target($1)', [input.productionId]);
    if (input.id && input.baseRevision > 0 && !await memoryGet(client, 'selection', input.id)) throw new FlowError('NOT_FOUND', 404);
    const state = await memoryReadState(client); bundles = [];
    for (const ref of input.evidence) bundles.push(await memoryBundle(client, ref.id, state));
  }, async client => {
    const previous = input.id ? await memoryGet<MemorySelection>(client, 'selection', input.id) : null;
    if (input.baseRevision !== (previous?.doc.revision ?? 0) || previous && previous.doc.productionId !== input.productionId) throw new FlowError('MEMORY_CONFLICT', 409);
    const items: MemorySelection['items'] = bundles.map((bundle, index) => {
      if (!sameMemoryEvidence(input.evidence[index], memoryEvidenceRef(bundle.evidence))) throw new FlowError('MEMORY_CONFLICT', 409);
      const eligibility = memoryView(bundle).eligibility;
      if (!eligibility.usable) { const error = new FlowError('MEMORY_NOT_READY', 409); error.reason = eligibility.reason; throw error; }
      const policy = bundle.policy ?? initialMemoryPolicy(context.portal);
      return { evidence: memoryEvidenceRef(bundle.evidence), check: bundle.check ? { id: bundle.check.id, revision: bundle.check.revision } : null,
        decisionId: memoryDecisionApplies(bundle.evidence, policy, bundle.check, bundle.decision) ? bundle.decision!.id : null, policyRevision: policy.revision };
    });
    const id = input.id ?? `memory-selection-${randomUUID()}`;
    const doc = { id, workspaceId: context.portal, revision: input.baseRevision + 1, productionId: input.productionId, items };
    return (await client.query('SELECT public.reporter_memory_selection_save($1::jsonb) AS value', [JSON.stringify({ kind: 'selection', id,
      expected: previous?.storage_revision ?? null, doc })])).rows[0].value.doc;
  });
}
export async function readMemorySelection(id: string): Promise<MemorySelection> {
  memoryIdSchema.parse(id);
  return memoryRead(async client => {
    const stored = await memoryGet<MemorySelection>(client, 'selection', id);
    if (!stored) throw new FlowError('NOT_FOUND', 404);
    return stored.doc;
  });
}
export async function readMemorySelections(value: MemoryHistoryQuery): Promise<MemoryPage<MemorySelection>> {
  const input = memoryHistoryQuerySchema.parse(value), context = currentReporterContext(), key = memoryCursorKey();
  return memoryRead(async client => {
    const state = await memoryReadState(client), binding = { tenant: context.tenant, workspace: context.portal, actor: context.actor, visibility: state.visibility };
    const identity = { resource: 'selections' as const, limit: input.limit }, cursor = input.cursor ? decodeMemoryCursor(input.cursor, identity, binding, key, Date.now()) : null;
    const result = (await client.query('SELECT public.reporter_memory_selection_page($1::bigint,$2::jsonb,$3,$4) AS value',
      [cursor?.snapshot ?? state.snapshot, cursor ? JSON.stringify(cursor.position) : null, input.limit, state.visibility])).rows[0].value;
    return { ...result, next: undefined, nextCursor: result.next ? encodeMemoryCursor({ snapshot: result.snapshot, position: result.next }, identity, binding, key, Date.now()) : null };
  });
}
