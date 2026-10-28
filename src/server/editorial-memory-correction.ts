import 'server-only';
import type { MemoryEvidence, MemoryEvidenceRef, MemoryEvidenceView } from '../domain/editorial-memory.ts';
import { memoryEvidenceRef, sameMemoryEvidence, resolveMemoryAnchor } from '../domain/editorial-memory.ts';
import type { MemoryCorrection } from '../ports/editorial-memory.ts';
import { memoryCorrectionSchema, memoryIdSchema } from './editorial-memory-input.ts';
import { memoryBundle, memoryReadState } from './editorial-memory-detail.ts';
import type { MemoryBundle } from './editorial-memory-query.ts';
import { memoryView } from './editorial-memory-query.ts';
import { memoryCommand, memoryGet } from './editorial-memory-store.ts';
import { FlowError } from './errors.ts';

export async function correctEditorialMemory(id: string, value: { expected: MemoryEvidenceRef; reason: string; changes: MemoryCorrection }, requestId: string): Promise<MemoryEvidenceView> {
  memoryIdSchema.parse(id);
  const input = memoryCorrectionSchema.parse(value);
  let bundle: MemoryBundle;
  return memoryCommand('memory.correct', { id, input }, requestId, 'library.edit', async client => {
    bundle = await memoryBundle(client, id, await memoryReadState(client));
  }, async client => {
    const current = bundle.evidence;
    if (!sameMemoryEvidence(input.expected, memoryEvidenceRef(current))) throw new FlowError('MEMORY_CONFLICT', 409);
    if (current.kind !== input.changes.kind) throw new FlowError('INVALID_INPUT', 422);
    const next = { ...current, ...input.changes, metadata: { ...current.metadata, ...input.changes.metadata }, revision: current.revision + 1 } as MemoryEvidence;
    if (memoryEvidenceRef(next).hash === memoryEvidenceRef(current).hash) throw new FlowError('INVALID_INPUT', 422);
    if (!bundle.source || resolveMemoryAnchor(bundle.source, next.anchor) === undefined
      || next.kind === 'citation' && next.authorConfirmed && !next.personId
      || next.kind === 'statistic' && (!next.anchor.excerpt.includes(next.value.raw) || !next.anchor.excerpt.includes(next.unit)
        || next.qualifier !== null && !next.anchor.excerpt.includes(next.qualifier))) throw new FlowError('INVALID_INPUT', 422);
    const stored = await memoryGet<MemoryEvidence>(client, 'evidence', id);
    if (!stored) throw new FlowError('NOT_FOUND', 404);
    await client.query('SELECT public.reporter_memory_correct($1,$2,$3::jsonb,$4,$5)', [id, stored.storage_revision, JSON.stringify(next), memoryEvidenceRef(next).hash, input.reason]);
    return memoryView(await memoryBundle(client, id, await memoryReadState(client)));
  });
}
