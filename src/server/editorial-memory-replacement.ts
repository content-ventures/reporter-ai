import 'server-only';
import { randomUUID } from 'node:crypto';
import type { MemoryReplacement } from '../domain/editorial-memory.ts';
import { memoryEvidenceRef, resolveMemoryAnchor, sameMemoryEvidence } from '../domain/editorial-memory.ts';
import { replaceMemoryEvidence } from '../domain/editorial-memory-replacement.ts';
import { sameRef } from '../domain/refs.ts';
import type { MemoryReplacementComparison, MemoryReplacementInput, MemoryReplacementResult } from '../ports/editorial-memory.ts';
import { memoryIdSchema, memoryReplacementSchema } from './editorial-memory-input.ts';
import { memoryBundle, memoryReadState } from './editorial-memory-detail.ts';
import type { MemoryBundle } from './editorial-memory-query.ts';
import { memoryView } from './editorial-memory-query.ts';
import { memoryCommand, memoryRead } from './editorial-memory-store.ts';
import { currentReporterContext } from './request-context.ts';
import { FlowError } from './errors.ts';

export async function replaceEditorialMemory(id: string, value: MemoryReplacementInput, requestId: string): Promise<MemoryReplacementResult> {
  memoryIdSchema.parse(id); const input = memoryReplacementSchema.parse(value), context = currentReporterContext();
  let previous: MemoryBundle, current: MemoryBundle;
  return memoryCommand('memory.replace', { id, input }, requestId, 'library.edit', async client => {
    const state = await memoryReadState(client); previous = await memoryBundle(client, id, state); current = await memoryBundle(client, input.replacement.id, state);
  }, async client => {
    if (id !== input.expected.id || !sameMemoryEvidence(input.expected, memoryEvidenceRef(previous.evidence))
      || !sameMemoryEvidence(input.replacement, memoryEvidenceRef(current.evidence))) throw new FlowError('MEMORY_CONFLICT', 409);
    if (!current.source?.rights.authorized || !resolveMemoryAnchor(current.source, current.evidence.anchor)
      || !sameRef(current.evidence.anchor.source, current.material.source)) throw new FlowError('INVALID_INPUT', 422);
    let changed: ReturnType<typeof replaceMemoryEvidence>;
    try { changed = replaceMemoryEvidence(previous.evidence, current.evidence, input.reason, { actorId: context.actor, now: new Date().toISOString(), newId: () => randomUUID() }); }
    catch (failure) { if ((failure as Error).message.startsWith('MEMORY_')) throw new FlowError('INVALID_INPUT', 422); throw failure; }
    const relation = (await client.query('SELECT public.reporter_memory_replace($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,$7,$8) AS value',
      [JSON.stringify(input.expected), JSON.stringify(input.replacement), JSON.stringify(changed.previous), JSON.stringify(changed.current),
        memoryEvidenceRef(changed.previous).hash, memoryEvidenceRef(changed.current).hash, input.reason, `memory-replacement-${randomUUID()}`])).rows[0].value as MemoryReplacement;
    const state = await memoryReadState(client);
    return { previous: memoryView(await memoryBundle(client, id, state)), current: memoryView(await memoryBundle(client, input.replacement.id, state)), relation };
  });
}
export async function readMemoryReplacement(id: string): Promise<MemoryReplacementComparison> {
  memoryIdSchema.parse(id);
  return memoryRead(async client => {
    const result = (await client.query('SELECT public.reporter_memory_replacement($1) AS value', [id])).rows[0].value;
    if (!result) throw new FlowError('NOT_FOUND', 404); return result;
  });
}
