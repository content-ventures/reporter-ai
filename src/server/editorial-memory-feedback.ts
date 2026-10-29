import 'server-only';
import type { MemoryFeedback, MemoryFeedbackQuery, MemoryRelevanceInput } from '../domain/editorial-memory-feedback.ts';
import type { MemoryPage } from '../domain/editorial-memory.ts';
import type { MemoryRelevanceContext } from '../ports/editorial-memory.ts';
import { memoryFeedbackQuerySchema, memoryRelevanceContextSchema, memoryRelevanceSchema } from './editorial-memory-input.ts';
import { memoryCommand, memoryRead } from './editorial-memory-store.ts';
import { memoryReadState } from './editorial-memory-detail.ts';
import { decodeMemoryCursor, encodeMemoryCursor } from './editorial-memory-cursor.ts';
import { memoryCursorKey } from './editorial-memory-query.ts';
import { currentReporterContext } from './request-context.ts';
import { FlowError } from './errors.ts';

export async function readMemoryFeedback(value: MemoryFeedbackQuery): Promise<MemoryPage<MemoryFeedback>> {
  const input = memoryFeedbackQuerySchema.parse(value), context = currentReporterContext(), key = memoryCursorKey();
  return memoryRead(async client => {
    const state = await memoryReadState(client), binding = { tenant: context.tenant, workspace: context.portal, actor: context.actor, visibility: state.visibility };
    const identity = { resource: 'feedback' as const, kind: input.kind, evidenceId: input.evidenceId, materialId: input.materialId, limit: input.limit };
    const cursor = input.cursor ? decodeMemoryCursor(input.cursor, identity, binding, key, Date.now()) : null;
    if (cursor && !/^[1-9]\d{0,18}$/.test(cursor.position.key)) throw new FlowError('MEMORY_CURSOR_INVALID', 409);
    const result = (await client.query('SELECT public.reporter_memory_feedback_page($1,$2,$3,$4::bigint,$5::bigint,$6,$7) AS value',
      [input.kind ?? null, input.evidenceId ?? null, input.materialId ?? null, cursor?.snapshot ?? state.snapshot, cursor?.position.key ?? null, input.limit, state.visibility])).rows[0].value;
    return { items: result.items, total: result.total, snapshot: result.snapshot,
      nextCursor: result.next ? encodeMemoryCursor({ snapshot: result.snapshot, position: result.next }, identity, binding, key, Date.now()) : null };
  });
}
export async function recordMemoryRelevance(value: MemoryRelevanceInput, requestId: string): Promise<MemoryFeedback> {
  const input = memoryRelevanceSchema.parse(value);
  return memoryCommand('memory.relevance', input, requestId, 'library.review', async client => {
    const available = (await client.query('SELECT public.reporter_memory_relevance_context($1::jsonb,$2::jsonb) AS value', [JSON.stringify(input.selection), JSON.stringify(input.evidence)])).rows[0].value;
    if (!available) throw new FlowError('NOT_FOUND', 404);
  }, async client => (await client.query('SELECT public.reporter_memory_relevance_save($1::jsonb,$2::jsonb,$3,$4) AS value',
    [JSON.stringify(input.selection), JSON.stringify(input.evidence), input.rating, input.reason])).rows[0].value);
}
export async function readMemoryRelevanceContext(value: Pick<MemoryRelevanceInput, 'selection' | 'evidence'>): Promise<MemoryRelevanceContext> {
  const input = memoryRelevanceContextSchema.parse(value);
  return memoryRead(async client => {
    const result = (await client.query('SELECT public.reporter_memory_relevance_context($1::jsonb,$2::jsonb) AS value', [JSON.stringify(input.selection), JSON.stringify(input.evidence)])).rows[0].value;
    if (!result) throw new FlowError('NOT_FOUND', 404); return result;
  });
}
