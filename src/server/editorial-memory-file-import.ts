import 'server-only';
import { randomUUID } from 'node:crypto';
import type { MemoryFileImportInput, MemoryImportResult } from '../ports/editorial-memory.ts';
import { memoryCommand } from './editorial-memory-store.ts';
import { readMemoryOriginalDocument } from './editorial-memory-original-files.ts';
import { prepareMemoryMaterial, readMemoryMaterial } from './editorial-memory-materials.ts';
import { readMemoryBatch } from './editorial-memory-batches.ts';
import { FlowError } from './errors.ts';

/** Individual and batch imports use the same atomic reconciliation and occurrence ledger. */
export async function importMemoryFile(input: MemoryFileImportInput, requestId: string, suppliedText?: string): Promise<MemoryImportResult> {
  const { file, document } = await readMemoryOriginalDocument(input.originalFileId);
  if (suppliedText !== undefined && suppliedText !== document.text) throw new FlowError('INVALID_INPUT', 422);
  const { originalFileId, ...fields } = input;
  const bundle = prepareMemoryMaterial({ ...fields, originalFileId, text: document.text });
  const result = await memoryCommand<{ batchId: string; itemId: string }>('memory.material.file-import', input, requestId, 'library.edit', async client => {
    const original = (await client.query('SELECT public.reporter_memory_original($1,true) AS value', [originalFileId])).rows[0].value;
    if (!original || original.status !== 'stored') throw new FlowError('NOT_FOUND', 404);
  }, async client => {
    const batchId = randomUUID(), itemId = randomUUID();
    const entry = { id: itemId, file: { name: file.name, size: file.size, checksum: file.checksum, delimiter: file.delimiter }, input: fields, issue: null };
    await client.query('SELECT public.reporter_memory_batch_create($1,$2,$3::jsonb)', [batchId, fields.title, JSON.stringify([entry])]);
    await client.query('SELECT public.reporter_memory_batch_bind($1,$2,1,$3)', [batchId, itemId, originalFileId]);
    await client.query('SELECT public.reporter_memory_batch_commit($1,$2,1,$3::jsonb,NULL)', [batchId, itemId, JSON.stringify(bundle)]);
    return { batchId, itemId };
  });
  const batch = await readMemoryBatch(result.batchId), item = batch.items.find(value => value.id === result.itemId);
  if (!item) throw new FlowError('NOT_FOUND', 404);
  if (item.status === 'pending_review') return { pending: result };
  if (!item.materialId || !['included', 'existing'].includes(item.status)) throw new FlowError('NOT_FOUND', 404);
  const material = await readMemoryMaterial(item.materialId);
  return { material: material.material, job: material.job, existing: item.status === 'existing', occurrence: result };
}
