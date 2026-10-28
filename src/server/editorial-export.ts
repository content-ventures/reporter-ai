import 'server-only';
import { z } from 'zod';
import { canExport } from '../domain/rules/export.ts';
import { sameVersionRef } from '../domain/refs.ts';
import { toVersionRef } from '../domain/piece.ts';
import { ok, refuse } from '../domain/result.ts';
import { assertCapability, editorialTransaction } from './editorial.ts';
import { guardMemoryCommand } from './editorial-memory-operation.ts';

const id = z.string().min(1).max(160);
const inputSchema = z.object({ productionId: id, selection: z.array(z.object({ kind: z.literal('version'),
  pieceId: id, versionId: id, number: z.number().int().positive(), hash: id }).strict()).min(1).max(20) }).strict();

/** Read-only preflight; selection, export preparation and a download never imply publication. */
export async function prepareEditorialExport(payload: unknown) {
  const input = inputSchema.parse(payload);
  return (await editorialTransaction('runtime', async (checkpoint, engine, client) => {
    assertCapability(checkpoint, 'delivery.record');
    const record = engine.records.record(input.productionId);
    if (!record) return refuse('unknown_production', 'Produção não encontrada.');
    for (const ref of input.selection) {
      const version = record.versions.find(version => version.id === ref.versionId);
      if (!version || version.number !== ref.number || !sameVersionRef(toVersionRef(version), ref)) return refuse('unknown_version', 'Confira as versões antes de preparar a entrega.');
    }
    const approved = canExport(record, input.selection);
    if (!approved.ok) return approved;
    const memory = await guardMemoryCommand(client, record, 'recordDelivery', [input]);
    return memory.ok ? ok(input.selection) : refuse('memory_not_ready', memory.refusal.message);
  }, false, 'reporter.edit', { productions: [input.productionId], pipelines: false })).value;
}
