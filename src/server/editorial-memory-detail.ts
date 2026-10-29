import 'server-only';
import type { PoolClient } from 'pg';
import type { MemoryHistoryKind, MemoryPage, MemoryEvidence, MemoryCheck, MemoryDecision, MemoryUse } from '../domain/editorial-memory.ts';
import { initialMemoryPolicy } from '../domain/editorial-memory.ts';
import type { MemoryDetail, MemoryHistoryEntry, MemoryHistoryQuery } from '../ports/editorial-memory.ts';
import { decodeMemoryCursor, encodeMemoryCursor } from './editorial-memory-cursor.ts';
import { memoryHistoryKindSchema, memoryHistoryQuerySchema, memoryIdSchema } from './editorial-memory-input.ts';
import { memoryCursorKey, memoryView } from './editorial-memory-query.ts';
import type { MemoryBundle } from './editorial-memory-query.ts';
import { memoryRead } from './editorial-memory-store.ts';
import { currentReporterContext } from './request-context.ts';
import { FlowError } from './errors.ts';

export type MemoryReadState = { snapshot: string; visibility: string };
export async function memoryReadState(client: PoolClient): Promise<MemoryReadState> {
  return (await client.query('SELECT public.reporter_memory_context() AS value')).rows[0].value;
}
export async function memoryBundle(client: PoolClient, id: string, state: MemoryReadState): Promise<MemoryBundle> {
  const result = (await client.query('SELECT public.reporter_memory_detail($1,$2::bigint,$3) AS value', [id, state.snapshot, state.visibility])).rows[0].value;
  if (!result) throw new FlowError('NOT_FOUND', 404);
  return result;
}
async function history<T extends MemoryHistoryEntry>(client: PoolClient, id: string, kind: MemoryHistoryKind, input: MemoryHistoryQuery,
  state: MemoryReadState): Promise<MemoryPage<T>> {
  const query = memoryHistoryQuerySchema.parse(input), context = currentReporterContext(), key = memoryCursorKey();
  const identity = { resource: 'history' as const, evidenceId: id, kind, limit: query.limit };
  const binding = { tenant: context.tenant, workspace: context.portal, actor: context.actor, visibility: state.visibility };
  const cursor = query.cursor ? decodeMemoryCursor(query.cursor, identity, binding, key, Date.now()) : null;
  if (cursor && !/^(?:0|[1-9]\d{0,18})$/.test(cursor.position.key)) throw new FlowError('MEMORY_CURSOR_INVALID', 409);
  const result = (await client.query('SELECT public.reporter_memory_history($1,$2,$3::bigint,$4::bigint,$5,$6) AS value',
    [id, kind, cursor?.snapshot ?? state.snapshot, cursor?.position.key ?? null, query.limit, state.visibility])).rows[0].value as {
      items: T[]; total: number; snapshot: string; next: { key: string; id: string } | null } | null;
  if (!result) throw new FlowError('NOT_FOUND', 404);
  return { items: result.items, total: result.total, snapshot: result.snapshot,
    nextCursor: result.next ? encodeMemoryCursor({ snapshot: result.snapshot, position: result.next }, identity, binding, key, Date.now()) : null };
}
export async function readMemoryHistory(id: string, kind: MemoryHistoryKind, input: MemoryHistoryQuery): Promise<MemoryPage<MemoryHistoryEntry>> {
  memoryIdSchema.parse(id); memoryHistoryKindSchema.parse(kind);
  return memoryRead(async client => history(client, id, kind, input, await memoryReadState(client)));
}
export async function readMemoryDetail(id: string): Promise<MemoryDetail> {
  memoryIdSchema.parse(id);
  return memoryRead(async client => {
    const state = await memoryReadState(client), bundle = await memoryBundle(client, id, state);
    const checkJob = (await client.query('SELECT public.reporter_memory_check_job($1) AS value', [id])).rows[0].value;
    const checks = await history<MemoryCheck>(client, id, 'checks', {}, state);
    const decisions = await history<MemoryDecision>(client, id, 'decisions', {}, state);
    const revisions = await history<MemoryEvidence>(client, id, 'revisions', {}, state);
    const occurrences = await history<MemoryUse>(client, id, 'occurrences', {}, state);
    const links = (await client.query('SELECT public.reporter_memory_replacements($1) AS value', [id])).rows[0].value as MemoryDetail['replacements'];
    // An edge committed after this detail's snapshot belongs to the next refresh.
    const replacements = { previous: links?.previous && links.previous.current.after.revision <= bundle.evidence.revision ? links.previous : null,
      next: links?.next && links.next.previous.after.revision <= bundle.evidence.revision ? links.next : null };
    const version = bundle.source?.versions.find(version => version.number === bundle.evidence.anchor.source.sourceVersion);
    return { ...memoryView(bundle), material: bundle.material, policy: bundle.policy ?? initialMemoryPolicy(currentReporterContext().portal),
      source: { ref: bundle.evidence.anchor.source, authorized: bundle.source?.rights.authorized ?? false, segments: version?.content.segments ?? [] },
      checkJob, checks, decisions, revisions, occurrences, replacements };
  });
}
