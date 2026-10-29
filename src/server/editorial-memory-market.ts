import 'server-only';
import { z } from 'zod';
import { mapMemoryMarketRows, type MemoryMarketMapping, type MemoryMarketPlan } from '../domain/editorial-memory-market.ts';
import { readMemoryDocument } from '../domain/editorial-memory-document.ts';
import type { MemoryMaterial } from '../domain/editorial-memory.ts';
import { memoryIdSchema } from './editorial-memory-input.ts';
import { downloadMemoryOriginal, readMemoryOriginal } from './editorial-memory-original-files.ts';
import { readMemoryMaterial } from './editorial-memory-materials.ts';
import { memoryAuthorizeWrite, memoryCommand, memoryGet, memoryRead } from './editorial-memory-store.ts';
import { FlowError } from './errors.ts';

const column = z.object({ record: z.enum(['header', 'row']), column: z.number().int().min(0).max(127) }).strict();
const mapping = z.object({ institution: column, indicator: column, value: column, unit: column, period: column,
  geography: column.optional(), population: column.optional(), qualifier: column.optional() }).strict();
const previewInput = z.object({ mapping: mapping.optional(), start: z.number().int().min(1).max(10000).default(1) }).strict();
const saveInput = z.object({ mapping, revision: z.number().int().nonnegative(), materialRevision: z.number().int().positive() }).strict();
const sameSource = (a: MemoryMaterial['source'], b: MemoryMaterial['source']) => a.kind === b.kind && a.sourceId === b.sourceId
  && a.sourceVersion === b.sourceVersion && a.hash === b.hash;

async function documentFor(id: string) {
  memoryIdSchema.parse(id);
  await memoryRead(client => memoryAuthorizeWrite(client, 'library.edit'));
  const initial = await readMemoryMaterial(id), material = initial.material;
  if (material.kind !== 'market_data' || !material.originalFileId) throw new FlowError('INVALID_INPUT', 422);
  const file = await readMemoryOriginal(material.originalFileId), response = await downloadMemoryOriginal(file.id);
  const parsed = readMemoryDocument({ name: file.name, bytes: new Uint8Array(await response.arrayBuffer()), ...(file.delimiter ? { delimiter: file.delimiter } : {}) });
  if (!parsed.ok || !['csv', 'tsv'].includes(parsed.value.format) || parsed.value.format !== file.format
    || parsed.value.delimiter !== file.delimiter || file.parserVersion !== 'memory-document-v1') throw new FlowError('INVALID_INPUT', 422);
  const version = initial.source.versions[0];
  if (!version || version.content.segments.length !== 1 || version.content.segments[0].id !== 'original'
    || version.content.segments[0].text !== parsed.value.text || version.hash !== material.source.hash) throw new FlowError('MEMORY_CONFLICT', 409);
  const current = await readMemoryMaterial(id);
  if (current.material.revision !== material.revision || current.material.originalFileId !== file.id || !sameSource(current.material.source, material.source))
    throw new FlowError('MEMORY_CONFLICT', 409);
  return { material, file, document: parsed.value };
}

export async function readMemoryMarketMapping(id: string): Promise<MemoryMarketPlan | null> {
  memoryIdSchema.parse(id);
  return memoryRead(async client => {
    if (!await memoryGet(client, 'material', id)) throw new FlowError('NOT_FOUND', 404);
    return (await client.query('SELECT public.reporter_memory_market_mapping($1) AS value', [id])).rows[0].value;
  });
}
export async function previewMemoryMarket(id: string, value: unknown) {
  const input = previewInput.parse(value), { material, file, document } = await documentFor(id);
  const headers = document.locations[0]?.cells?.map(cell => cell.value) ?? [];
  if (!headers.length || document.locations.length < 2) throw new FlowError('INVALID_INPUT', 422);
  const result = input.mapping ? mapMemoryMarketRows(document, input.mapping, input.start) : null;
  if (result && !result.ok) { const error = new FlowError('INVALID_INPUT', 422); error.reason = result.refusal.message; throw error; }
  return { materialRevision: material.revision, source: material.source, originalFileId: file.id, checksum: file.checksum,
    headers, preview: result?.ok ? result.value : null, mapping: await readMemoryMarketMapping(id) };
}
export async function saveMemoryMarketMapping(id: string, value: unknown, key: string): Promise<MemoryMarketPlan> {
  const input = saveInput.parse(value), { material, file, document } = await documentFor(id);
  if (input.materialRevision !== material.revision) throw new FlowError('MEMORY_CONFLICT', 409);
  const mapped = mapMemoryMarketRows(document, input.mapping as MemoryMarketMapping);
  if (!mapped.ok) { const error = new FlowError('INVALID_INPUT', 422); error.reason = mapped.refusal.message; throw error; }
  const proof = { source: material.source, originalFileId: file.id, checksum: file.checksum, mapping: input.mapping };
  return memoryCommand('memory.market.mapping', { id, ...input, proof }, key, 'library.edit', async client => {
    const stored = await memoryGet<MemoryMaterial>(client, 'material', id);
    if (!stored) throw new FlowError('NOT_FOUND', 404);
    if (stored.doc.revision !== input.materialRevision || stored.doc.originalFileId !== file.id || !sameSource(stored.doc.source, material.source))
      throw new FlowError('MEMORY_CONFLICT', 409);
  }, async client => {
    const saved = (await client.query('SELECT public.reporter_memory_market_mapping_save($1,$2,$3::jsonb) AS value', [id, input.revision, JSON.stringify(proof)])).rows[0].value;
    if (!saved) throw new FlowError('NOT_FOUND', 404); return saved;
  });
}
