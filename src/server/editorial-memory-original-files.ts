import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { readMemoryDocument } from '../domain/editorial-memory-document.ts';
import type { MemoryOriginalFile } from '../domain/editorial-memory-original-file.ts';
import { MAX_TEXT_BYTES } from '../domain/reporter.ts';
import { reporterDeploymentMode } from './deployment.ts';
import { FlowError } from './errors.ts';
import { memoryImportInputSchema } from './editorial-memory-input.ts';
import { importEditorialMemory } from './editorial-memory-materials.ts';
import { readMemoryOriginalObject, writeMemoryOriginalObject } from './editorial-memory-original-storage.ts';
import { memoryAuthorizeWrite, memoryCommand, memoryRead } from './editorial-memory-store.ts';
import { currentReporterContext } from './request-context.ts';

const uploadSchema = z.object({ name: z.string().min(1).max(255), bytes: z.string().min(1).max(2 * MAX_TEXT_BYTES),
  delimiter: z.enum([',', ';', '\t']).optional() }).strict();
const fileImportSchema = memoryImportInputSchema.omit({ text: true, originalFileId: true }).extend({ originalFileId: z.guid() }).strict();
export type MemoryOriginalHooks = { identity: object; authorize(client: PoolClient): Promise<void>;
  prepared(client: PoolClient, file: MemoryOriginalFile): Promise<void>; stored(client: PoolClient, file: MemoryOriginalFile): Promise<void> };
const stageKey = (stage: string, key: string) => createHash('sha256').update(`memory-original:${stage}:${key}`).digest('hex');

function document(file: { name: string; delimiter?: ',' | ';' | '\t' | null }, bytes: Buffer) {
  const result = readMemoryDocument({ name: file.name, bytes, ...(file.delimiter ? { delimiter: file.delimiter } : {}) });
  if (result.ok) return result.value;
  const failure = new FlowError('MEMORY_ORIGINAL_INVALID', result.refusal.code === 'too_large' ? 413 : result.refusal.code === 'unsupported_type' ? 415 : 422);
  failure.reason = result.refusal.message; throw failure;
}
export async function uploadMemoryOriginal(value: unknown, requestId: string, hooks?: MemoryOriginalHooks): Promise<MemoryOriginalFile> {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) throw new FlowError('IDEMPOTENCY_KEY_REQUIRED', 422);
  const input = uploadSchema.parse(value);
  await memoryRead(async client => { await memoryAuthorizeWrite(client, 'library.edit'); await hooks?.authorize(client); });
  const bytes = Buffer.from(input.bytes, 'base64');
  if (bytes.toString('base64') !== input.bytes) throw new FlowError('INVALID_INPUT', 422);
  const parsed = document(input, bytes), context = currentReporterContext();
  const stored = { name: parsed.fileName, size: bytes.length, checksum: createHash('sha256').update(bytes).digest('hex'),
    format: parsed.format, delimiter: parsed.delimiter, parserVersion: 'memory-document-v1', storage: reporterDeploymentMode() === 'local' ? 'local' : 's3' };
  const prepared = await memoryCommand<MemoryOriginalFile>('memory.original.prepare', hooks ? { file: stored, binding: hooks.identity } : stored,
    stageKey('prepare', requestId), 'library.edit', async client => { await hooks?.authorize(client); }, async client => {
      const file = (await client.query('SELECT public.reporter_memory_original_register($1::jsonb) AS value', [JSON.stringify({ ...stored, id: randomUUID(), workspaceId: context.portal })])).rows[0].value;
      await hooks?.prepared(client, file); return file;
    });
  const current = await readMemoryOriginal(prepared.id, true);
  // Durable pending metadata precedes storage; no external operation holds a transaction open.
  if (current.status !== 'stored') await writeMemoryOriginalObject({ checksum: stored.checksum, size: stored.size }, bytes);
  return completeMemoryOriginal(prepared.id, requestId, hooks);
}
export async function completeMemoryOriginal(id: string, requestId: string, hooks?: MemoryOriginalHooks): Promise<MemoryOriginalFile> {
  return memoryCommand('memory.original.complete', { id, ...(hooks ? { binding: hooks.identity } : {}) }, stageKey('complete', requestId), 'library.edit', async client => {
    if (!(await client.query('SELECT public.reporter_memory_original($1,true) AS value', [id])).rows[0].value) throw new FlowError('NOT_FOUND', 404);
    await hooks?.authorize(client);
  }, async client => {
    const file = (await client.query('SELECT public.reporter_memory_original_complete($1) AS value', [id])).rows[0].value;
    await hooks?.stored(client, file); return file;
  });
}
export async function resumeMemoryOriginal(id: string, bytes: Buffer, requestId: string, hooks: MemoryOriginalHooks) {
  const file = await readMemoryOriginal(id, true);
  if (bytes.length !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.checksum) throw new FlowError('MEMORY_BATCH_FILE_CHANGED', 409);
  await memoryRead(client => hooks.authorize(client));
  if (file.status !== 'stored') await writeMemoryOriginalObject({ checksum: file.checksum, size: file.size }, bytes);
  return completeMemoryOriginal(id, requestId, hooks);
}
export async function readMemoryOriginal(id: string, write = false): Promise<MemoryOriginalFile> {
  z.guid().parse(id);
  return memoryRead(async client => {
    const value = (await client.query('SELECT public.reporter_memory_original($1,$2) AS value', [id, write])).rows[0].value;
    if (!value) throw new FlowError('NOT_FOUND', 404); return value;
  });
}
async function originalBytes(file: MemoryOriginalFile, allowPending = false) {
  if (file.status !== 'stored' && !allowPending) throw new FlowError('MEMORY_ORIGINAL_PENDING', 409);
  if (file.storage !== (reporterDeploymentMode() === 'local' ? 'local' : 's3')) throw new FlowError('MEMORY_ORIGINAL_UNAVAILABLE', 503);
  try { return await readMemoryOriginalObject({ checksum: file.checksum, size: file.size }); }
  catch (error) { if (error instanceof FlowError) throw error; throw new FlowError('MEMORY_ORIGINAL_UNAVAILABLE', 503); }
}
export async function readMemoryOriginalDocument(id: string, allowPending = false) {
  const file = await readMemoryOriginal(id, true), bytes = await originalBytes(file, allowPending);
  return { file, document: document(file, bytes) };
}
export async function importMemoryOriginal(value: unknown, requestId: string) {
  const input = fileImportSchema.parse(value), file = await readMemoryOriginal(input.originalFileId, true);
  const parsed = document(file, await originalBytes(file));
  return importEditorialMemory({ ...input, text: parsed.text }, requestId);
}
export async function downloadMemoryOriginal(id: string) {
  const file = await readMemoryOriginal(id), bytes = await originalBytes(file);
  await readMemoryOriginal(id); // A revoked source/membership cannot ride a slow storage read.
  return new Response(new Uint8Array(bytes), { headers: { 'content-type': 'application/octet-stream', 'content-length': String(bytes.length),
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, character => '%' + character.charCodeAt(0).toString(16))}`,
    'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
}
