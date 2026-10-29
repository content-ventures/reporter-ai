import 'server-only';
import { randomUUID } from 'node:crypto';
import type { MemoryBlock, MemoryMaterial, MemoryPage } from '../domain/editorial-memory.ts';
import { createMemoryMaterial, memoryBlocks } from '../domain/editorial-memory-import.ts';
import type { EditorialMemory, MemoryImportInput, MemoryJob, MemoryHistoryQuery } from '../ports/editorial-memory.ts';
import { decodeMemoryCursor, encodeMemoryCursor } from './editorial-memory-cursor.ts';
import { memoryAuthorizationSchema, memoryCancelSchema, memoryHistoryQuerySchema, memoryIdSchema, memoryImportInputSchema, memoryRetrySchema } from './editorial-memory-input.ts';
import { memoryCommand, memoryGet, memoryRead } from './editorial-memory-store.ts';
import { memoryReadState } from './editorial-memory-detail.ts';
import { memoryCursorKey } from './editorial-memory-query.ts';
import { currentReporterContext } from './request-context.ts';
import { FlowError } from './errors.ts';
import { generationModel } from './text-generation.ts';

export async function importEditorialMemory(value: MemoryImportInput, requestId: string): Promise<{ material: MemoryMaterial; job: MemoryJob }> {
  const input = memoryImportInputSchema.parse(value), context = currentReporterContext();
  return memoryCommand('memory.material.import', input, requestId, 'library.edit', async client => {
    await client.query('SELECT public.reporter_memory_import_access($1)', [input.originalFileId]);
  }, async client => {
    const now = new Date().toISOString(), created = createMemoryMaterial(input, context.portal, { actorId: context.actor, now, newId: prefix => `${prefix}-${randomUUID()}` });
    const id = `memory-job-${randomUUID()}`, blocks = memoryBlocks(created.material, id, input.text);
    const job: MemoryJob = { id, workspaceId: context.portal, revision: 1, kind: 'extract', materialId: created.material.id, evidenceId: null,
      sourceVersion: created.material.source.sourceVersion, sourceHash: created.material.source.hash, extractorVersion: 'memory-extract-v1', model: generationModel(), generation: 1, status: 'queued',
      totalBlocks: blocks.length, completedBlocks: 0, failedBlocks: 0, evidenceCount: 0, error: null, createdBy: context.actor, createdAt: now, updatedAt: now };
    return (await client.query('SELECT public.reporter_memory_import($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb) AS value',
      [JSON.stringify(created.source), JSON.stringify(created.material), JSON.stringify(job), JSON.stringify(blocks)])).rows[0].value;
  });
}
export async function readMemoryJob(id: string): Promise<MemoryJob> {
  memoryIdSchema.parse(id);
  return memoryRead(async client => { const value = (await client.query('SELECT public.reporter_memory_job($1) AS value', [id])).rows[0].value;
    if (!value) throw new FlowError('NOT_FOUND', 404); return value; });
}
export async function readMemoryMaterial(id: string, revision?: number): ReturnType<EditorialMemory['material']> {
  memoryIdSchema.parse(id);
  if (revision !== undefined) memoryCancelSchema.parse({ baseRevision: revision });
  return memoryRead(async client => { const value = (revision === undefined ? await client.query('SELECT public.reporter_memory_material_detail($1) AS value', [id])
    : await client.query('SELECT public.reporter_memory_material_version($1,$2) AS value', [id, revision])).rows[0].value;
    if (!value) throw new FlowError('NOT_FOUND', 404); return value; });
}
export async function readMemoryMaterials(input: MemoryHistoryQuery): Promise<MemoryPage<MemoryMaterial & { job: MemoryJob | null }>> {
  return resourcePage('materials', null, input);
}
export async function readMemoryBlocks(jobId: string, input: MemoryHistoryQuery): Promise<MemoryPage<MemoryBlock>> {
  memoryIdSchema.parse(jobId); return resourcePage('blocks', jobId, input);
}
async function resourcePage<T>(kind: 'materials' | 'blocks', jobId: string | null, input: MemoryHistoryQuery): Promise<MemoryPage<T>> {
  const query = memoryHistoryQuerySchema.parse(input), context = currentReporterContext(), key = memoryCursorKey();
  return memoryRead(async client => {
    const state = await memoryReadState(client), binding = { tenant: context.tenant, workspace: context.portal, actor: context.actor, visibility: state.visibility };
    const identity = kind === 'materials' ? { resource: 'materials' as const, limit: query.limit } : { resource: 'blocks' as const, jobId: jobId!, limit: query.limit };
    const cursor = query.cursor ? decodeMemoryCursor(query.cursor, identity, binding, key, Date.now()) : null;
    if (kind === 'blocks' && cursor && !/^\d{1,6}$/.test(cursor.position.key)) throw new FlowError('MEMORY_CURSOR_INVALID', 409);
    const snapshot = cursor?.snapshot ?? state.snapshot;
    const result = (kind === 'materials'
      ? await client.query('SELECT public.reporter_memory_material_page($1::bigint,$2::jsonb,$3,$4) AS value', [snapshot, cursor ? JSON.stringify(cursor.position) : null, query.limit, state.visibility])
      : await client.query('SELECT public.reporter_memory_block_page($1,$2::bigint,$3,$4,$5) AS value', [jobId, snapshot, cursor ? Number(cursor.position.key) : null, query.limit, state.visibility])).rows[0].value;
    if (!result) throw new FlowError('NOT_FOUND', 404);
    return { ...result, next: undefined, nextCursor: result.next ? encodeMemoryCursor({ snapshot: result.snapshot, position: result.next }, identity, binding, key, Date.now()) : null };
  });
}
export async function actMemoryJob(id: string, action: 'retry' | 'cancel', input: { baseRevision?: number }, requestId: string): Promise<MemoryJob> {
  memoryIdSchema.parse(id); (action === 'cancel' ? memoryCancelSchema : memoryRetrySchema).parse(input);
  return memoryCommand(`memory.job.${action}`, { id, input }, requestId, 'library.edit', async client => {
    if (!await memoryGet(client, 'job', id)) throw new FlowError('NOT_FOUND', 404);
  }, async client => (await client.query('SELECT public.reporter_memory_job_action($1,$2,$3) AS value', [id, action, input.baseRevision ?? null])).rows[0].value);
}

export async function authorizeMemoryMaterial(id: string, value: { baseRevision: number; authorized: boolean; reason: string }, requestId: string): Promise<MemoryMaterial> {
  memoryIdSchema.parse(id); const input = memoryAuthorizationSchema.parse(value);
  return memoryCommand('memory.material.authorization', { id, input }, requestId, 'library.edit', async client => {
    if (!await memoryGet(client, 'material', id)) throw new FlowError('NOT_FOUND', 404);
  }, async client => (await client.query('SELECT public.reporter_memory_material_rights($1,$2,$3,$4) AS value', [id, input.baseRevision, input.authorized, input.reason])).rows[0].value);
}
