import 'server-only';
import type { MemoryCorrectionImpact, MemoryHistoryQuery, MemoryImpactScope } from '../ports/editorial-memory.ts';
import { memoryHistoryQuerySchema, memoryIdSchema } from './editorial-memory-input.ts';
import { memoryRead } from './editorial-memory-store.ts';
import { memoryReadState } from './editorial-memory-detail.ts';
import { decodeMemoryCursor, encodeMemoryCursor } from './editorial-memory-cursor.ts';
import { memoryCursorKey } from './editorial-memory-query.ts';
import { currentReporterContext } from './request-context.ts';
import { FlowError } from './errors.ts';

/** Bounded read only: no article mutation, use counter, audit decision or provider call. */
export async function readMemoryCorrectionImpact(scope: MemoryImpactScope, value: MemoryHistoryQuery): Promise<MemoryCorrectionImpact> {
  memoryIdSchema.parse(scope.id);
  if (!['material', 'evidence'].includes(scope.kind)) throw new FlowError('INVALID_INPUT', 422);
  const input = memoryHistoryQuerySchema.parse(value), context = currentReporterContext(), key = memoryCursorKey();
  return memoryRead(async client => {
    const state = await memoryReadState(client), binding = { tenant: context.tenant, workspace: context.portal, actor: context.actor, visibility: state.visibility };
    const identity = { resource: 'correction-impact' as const, ...scope, limit: input.limit };
    const cursor = input.cursor ? decodeMemoryCursor(input.cursor, identity, binding, key, Date.now()) : null;
    const result = (await client.query('SELECT public.reporter_memory_correction_impact($1,$2,$3::bigint,$4::jsonb,$5,$6) AS value',
      [scope.kind, scope.id, cursor?.snapshot ?? state.snapshot, cursor ? JSON.stringify(cursor.position) : null, input.limit, state.visibility])).rows[0].value;
    if (!result) throw new FlowError('NOT_FOUND', 404);
    return { ...result, next: undefined, nextCursor: result.next ? encodeMemoryCursor({ snapshot: result.snapshot, position: result.next }, identity, binding, key, Date.now()) : null };
  });
}
