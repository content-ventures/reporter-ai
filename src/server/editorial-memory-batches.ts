import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { MemoryBatch, MemoryBatchComparison, MemoryBatchFile, MemoryBatchItem, MemoryBatchIssue, MemoryBatchSummary } from '../ports/editorial-memory-batch.ts';
import { MEMORY_BATCH_MAX_ITEMS } from '../ports/editorial-memory-batch.ts';
import type { MemoryPage } from '../domain/editorial-memory.ts';
import type { MemoryHistoryQuery } from '../ports/editorial-memory.ts';
import { memoryHistoryQuerySchema, memoryImportInputSchema } from './editorial-memory-input.ts';
import { memoryCommand, memoryRead } from './editorial-memory-store.ts';
import { completeMemoryOriginal, readMemoryOriginalDocument, resumeMemoryOriginal, uploadMemoryOriginal, type MemoryOriginalHooks } from './editorial-memory-original-files.ts';
import { prepareMemoryMaterial } from './editorial-memory-materials.ts';
import { decodeMemoryCursor, encodeMemoryCursor } from './editorial-memory-cursor.ts';
import { memoryReadState } from './editorial-memory-detail.ts';
import { memoryCursorKey } from './editorial-memory-query.ts';
import { currentReporterContext } from './request-context.ts';
import { FlowError } from './errors.ts';

const fields = memoryImportInputSchema.omit({ text: true, originalFileId: true });
const fileSchema = z.object({ name: z.string().min(1).max(255), size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  checksum: z.string().regex(/^[a-f0-9]{64}$/).nullable(), delimiter: z.enum([',', ';', '\t']).nullable() }).strict();
const itemSchema = z.object({ id: z.guid(), file: fileSchema, input: fields }).strict();
const createSchema = z.object({ title: z.string().trim().min(1).max(160), items: z.array(itemSchema).min(1).max(MEMORY_BATCH_MAX_ITEMS) }).strict()
  .refine(value => new Set(value.items.map(item => item.id)).size === value.items.length, 'Os documentos precisam de identificadores distintos.');
const revisionSchema = z.number().int().positive();
const candidateSchema = z.object({ id: z.string().min(1).max(128), revision: revisionSchema,
  source: z.object({ kind: z.literal('source-version'), sourceId: z.string().min(1).max(128), sourceVersion: revisionSchema, hash: z.string().min(1).max(128) }).strict() }).strict();
const processSchema = z.object({ revision: revisionSchema, decision: z.object({ choice: z.enum(['reuse', 'distinct']),
  expected: candidateSchema, reason: z.string().trim().min(1).max(2000) }).strict().optional() }).strict();
function issue(file: MemoryBatchFile): MemoryBatchIssue | null {
  const refusal = (code: string, message: string, terminal = true) => ({ code, message, terminal });
  if (/[\\/\x00-\x1f\x7f-\x9f]/.test(file.name)) return refusal('invalid_document', 'Use um nome de arquivo válido, sem caminho.');
  const extension = file.name.split('.').at(-1)?.toLowerCase();
  if (!file.name.includes('.') || !['txt', 'md', 'srt', 'vtt', 'csv', 'tsv'].includes(extension ?? '')) return refusal('unsupported_type', 'Escolha um arquivo TXT, MD, SRT, VTT, CSV ou TSV.');
  if (file.size > 1048576) return refusal('too_large', 'Divida o documento em arquivos de até 1 MiB.');
  if (!file.size) return refusal('empty', 'O arquivo está vazio.');
  if (extension === 'csv' && file.delimiter === null || extension === 'tsv' && file.delimiter !== '\t'
    || !['csv', 'tsv'].includes(extension!) && file.delimiter !== null) return refusal('invalid_document', 'Confira o separador do arquivo.');
  return file.checksum ? null : refusal('file_required', 'Selecione novamente o arquivo para conferir seu conteúdo.', false);
}
async function itemFor(client: PoolClient, batch: string, item: string, revision?: number, write = false): Promise<MemoryBatchItem> {
  const value = (await client.query('SELECT public.reporter_memory_batch_item($1,$2,$3,$4) AS value', [batch, item, revision ?? null, write])).rows[0].value;
  if (!value) throw new FlowError('NOT_FOUND', 404); return value;
}
const identity = (batch: string, item: string, revision: number) => ({ batch, item, revision });
const originalKey = (batch: string, item: string, revision: number) => createHash('sha256').update(`memory-batch-file:${currentReporterContext().actor}:${batch}:${item}:${revision}`).digest('hex');
function hooks(batch: string, item: string, revision: number): MemoryOriginalHooks {
  return { identity: identity(batch, item, revision), authorize: async client => { await itemFor(client, batch, item, revision, true); },
    prepared: async (client, file) => { await client.query('SELECT public.reporter_memory_batch_bind($1,$2,$3,$4)', [batch, item, revision, file.id]); },
    stored: async (client, file) => { await client.query('SELECT public.reporter_memory_batch_ready($1,$2,$3,$4)', [batch, item, revision, file.id]); } };
}
async function recordFailure(batch: string, item: string, revision: number, failure: unknown) {
  if (failure instanceof FlowError && [403, 404, 409].includes(failure.status)) return;
  const error: MemoryBatchIssue = { code: failure instanceof FlowError ? failure.code : 'STORAGE_UNAVAILABLE',
    message: failure instanceof FlowError && failure.status < 500 ? failure.reason ?? 'Confira o arquivo e tente novamente.' : 'Não foi possível acessar o arquivo. Tente novamente.',
    terminal: failure instanceof FlowError && [413, 415, 422].includes(failure.status) };
  try { await memoryCommand('memory.batch.issue', { ...identity(batch, item, revision), error }, randomUUID(), 'library.edit',
    async client => { await itemFor(client, batch, item, revision, true); }, async client =>
      (await client.query('SELECT public.reporter_memory_batch_issue($1,$2,$3,$4::jsonb) AS value', [batch, item, revision, JSON.stringify(error)])).rows[0].value); }
  catch { /* Preserve the actual failure; a revoked or superseded item cannot receive a late error. */ }
}
export async function createMemoryBatch(value: unknown, requestId: string): Promise<MemoryBatch> {
  const input = createSchema.parse(value);
  const result = await memoryCommand<{ id: string }>('memory.batch.create', input, requestId, 'library.edit', async () => {}, async client =>
    (await client.query('SELECT public.reporter_memory_batch_create($1,$2,$3::jsonb) AS value', [randomUUID(), input.title,
      JSON.stringify(input.items.map(item => ({ ...item, issue: issue(item.file) })))])).rows[0].value);
  return readMemoryBatch(result.id);
}
export async function readMemoryBatch(batch: string): Promise<MemoryBatch> {
  z.guid().parse(batch);
  return memoryRead(async client => { const value = (await client.query('SELECT public.reporter_memory_batch($1) AS value', [batch])).rows[0].value;
    if (!value) throw new FlowError('NOT_FOUND', 404); return value; });
}
export async function readMemoryBatchCandidate(batch: string, item: string): Promise<MemoryBatchComparison | null> {
  z.guid().parse(batch); z.guid().parse(item);
  return memoryRead(async client => {
    await itemFor(client, batch, item);
    return (await client.query('SELECT public.reporter_memory_batch_candidate($1,$2) AS value', [batch, item])).rows[0].value;
  });
}
export async function readMemoryBatches(value: MemoryHistoryQuery): Promise<MemoryPage<MemoryBatchSummary>> {
  const query = memoryHistoryQuerySchema.parse(value), context = currentReporterContext(), key = memoryCursorKey();
  return memoryRead(async client => {
    const state = await memoryReadState(client), binding = { tenant: context.tenant, workspace: context.portal, actor: context.actor, visibility: state.visibility };
    const identity = { resource: 'import-batches' as const, limit: query.limit }, cursor = query.cursor ? decodeMemoryCursor(query.cursor, identity, binding, key, Date.now()) : null;
    if (cursor && !/^\d{1,19}$/.test(cursor.position.key)) throw new FlowError('MEMORY_CURSOR_INVALID', 409);
    const result = (await client.query('SELECT public.reporter_memory_batch_page($1::bigint,$2::bigint,$3,$4) AS value', [cursor?.snapshot ?? null, cursor?.position.key ?? null, query.limit, state.visibility])).rows[0].value;
    return { ...result, next: undefined, nextCursor: result.next ? encodeMemoryCursor({ snapshot: result.snapshot, position: result.next }, identity, binding, key, Date.now()) : null };
  });
}
export async function updateMemoryBatchItem(batch: string, item: string, value: unknown, requestId: string): Promise<MemoryBatch> {
  z.guid().parse(batch); z.guid().parse(item);
  const input = z.object({ revision: revisionSchema, file: fileSchema, input: fields, reason: z.string().trim().min(1).max(2000) }).strict().parse(value);
  await memoryCommand('memory.batch.update', { batch, item, input }, requestId, 'library.edit', async client => {
    // Successful replay validates access; the write checks the prior revision under lock.
    await itemFor(client, batch, item, undefined, true);
  }, async client => (await client.query('SELECT public.reporter_memory_batch_update($1,$2,$3,$4::jsonb,$5) AS value',
    [batch, item, input.revision, JSON.stringify({ file: input.file, input: input.input, issue: issue(input.file) }), input.reason])).rows[0].value);
  return readMemoryBatch(batch);
}
export async function uploadMemoryBatchItem(batch: string, item: string, value: unknown, requestId: string): Promise<MemoryBatch> {
  z.guid().parse(batch); z.guid().parse(item);
  const input = z.object({ revision: revisionSchema, bytes: z.string().min(1).max(2 * 1048576) }).strict().parse(value);
  const current = await memoryRead(client => itemFor(client, batch, item, input.revision, true)), bytes = Buffer.from(input.bytes, 'base64');
  if (bytes.toString('base64') !== input.bytes || current.file.size !== bytes.length || current.file.checksum !== createHash('sha256').update(bytes).digest('hex'))
    throw new FlowError('MEMORY_BATCH_FILE_CHANGED', 409);
  await memoryCommand('memory.batch.upload.intent', { ...identity(batch, item, input.revision), checksum: current.file.checksum }, requestId, 'library.edit',
    async client => { await itemFor(client, batch, item, input.revision, true); }, async () => true);
  if (current.original?.status === 'stored') return readMemoryBatch(batch);
  try {
    if (current.original) await resumeMemoryOriginal(current.original.id, bytes, originalKey(batch, item, input.revision), hooks(batch, item, input.revision));
    else await uploadMemoryOriginal({ name: current.file.name, bytes: input.bytes, ...(current.file.delimiter ? { delimiter: current.file.delimiter } : {}) },
        originalKey(batch, item, input.revision), hooks(batch, item, input.revision));
    return readMemoryBatch(batch);
  } catch (error) { await recordFailure(batch, item, input.revision, error); throw error; }
}
export async function processMemoryBatchItem(batch: string, item: string, value: unknown, requestId: string): Promise<MemoryBatch> {
  z.guid().parse(batch); z.guid().parse(item); const input = processSchema.parse(value);
  const current = await memoryRead(client => itemFor(client, batch, item, input.revision, true));
  try {
    let bundle: ReturnType<typeof prepareMemoryMaterial> | null = null;
    if (!['included', 'existing'].includes(current.status) && !(current.status === 'pending_review' && !input.decision)) {
      if (!current.original) throw new FlowError('MEMORY_ORIGINAL_PENDING', 409);
      const original = await readMemoryOriginalDocument(current.original.id, true);
      if (original.file.status !== 'stored') await completeMemoryOriginal(original.file.id, originalKey(batch, item, input.revision), hooks(batch, item, input.revision));
      bundle = prepareMemoryMaterial({ ...current.input, text: original.document.text, originalFileId: original.file.id });
    }
    await memoryCommand('memory.batch.process', { batch, item, input }, requestId, 'library.edit', async client => {
      await itemFor(client, batch, item, input.revision, true);
    }, async client => (await client.query('SELECT public.reporter_memory_batch_commit($1,$2,$3,$4::jsonb,$5::jsonb) AS value',
      [batch, item, input.revision, bundle ? JSON.stringify(bundle) : null, input.decision ? JSON.stringify(input.decision) : null])).rows[0].value);
    return readMemoryBatch(batch);
  } catch (error) { await recordFailure(batch, item, input.revision, error); throw error; }
}
