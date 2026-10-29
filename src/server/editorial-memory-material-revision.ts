import 'server-only';
import { randomUUID } from 'node:crypto';
import type { EditorialMemory, MemoryJob } from '../ports/editorial-memory.ts';
import type { MemoryMaterial } from '../domain/editorial-memory.ts';
import type { Source } from '../domain/source.ts';
import { reviseMemoryMaterial } from '../domain/editorial-memory-material-revision.ts';
import { memoryBlocks } from '../domain/editorial-memory-import.ts';
import { stableStringify } from '../domain/text/hash.ts';
import { memoryMaterialRevisionSchema, memoryIdSchema } from './editorial-memory-input.ts';
import { memoryCommand } from './editorial-memory-store.ts';
import { currentReporterContext } from './request-context.ts';
import { FlowError } from './errors.ts';
import { generationModel } from './text-generation.ts';

export async function reviseEditorialMemoryMaterial(id: string, value: Parameters<EditorialMemory['reviseMaterial']>[1], requestId: string) {
  memoryIdSchema.parse(id); const input = memoryMaterialRevisionSchema.parse(value), context = currentReporterContext();
  let detail: { material: MemoryMaterial; source: Source };
  return memoryCommand('memory.material.revise', { id, input }, requestId, 'library.edit', async client => {
    detail = (await client.query('SELECT public.reporter_memory_material_detail($1) AS value', [id])).rows[0].value;
    if (!detail) throw new FlowError('NOT_FOUND', 404);
  }, async client => {
    if (detail.material.revision !== input.baseRevision || stableStringify(detail.material.source) !== stableStringify(input.source)) throw new FlowError('MEMORY_CONFLICT', 409);
    const now = new Date().toISOString();
    let revised: ReturnType<typeof reviseMemoryMaterial>;
    try { revised = reviseMemoryMaterial(detail.material, detail.source, input.text, input.reason, { actorId: context.actor, now, newId: prefix => `${prefix}-${randomUUID()}` }); }
    catch (failure) {
      if ((failure as Error).message === 'MEMORY_NO_CHANGES') throw new FlowError('INVALID_INPUT', 422);
      if ((failure as Error).message === 'MEMORY_CONFLICT') throw new FlowError('MEMORY_CONFLICT', 409);
      throw failure;
    }
    const jobId = `memory-job-${randomUUID()}`, blocks = memoryBlocks(revised.material, jobId, input.text);
    const job: MemoryJob = { id: jobId, workspaceId: context.portal, revision: 1, kind: 'extract', materialId: id, evidenceId: null,
      sourceVersion: revised.version.number, sourceHash: revised.version.hash, extractorVersion: 'memory-extract-v1', model: generationModel(), generation: 1, status: 'queued',
      totalBlocks: blocks.length, completedBlocks: 0, failedBlocks: 0, evidenceCount: 0, error: null, createdBy: context.actor, createdAt: now, updatedAt: now };
    return (await client.query('SELECT public.reporter_memory_material_revise($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7) AS value',
      [id, input.baseRevision, JSON.stringify(input.source), JSON.stringify(revised.version), JSON.stringify(job), JSON.stringify(blocks), input.reason])).rows[0].value as { material: MemoryMaterial; job: MemoryJob; affectedEvidence: number };
  });
}
