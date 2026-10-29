import 'server-only';
import type { MemoryEvidenceRef } from '../domain/editorial-memory.ts';
import type { MemoryJob } from '../ports/editorial-memory.ts';
import { memoryEvidenceRefSchema, memoryIdSchema } from './editorial-memory-input.ts';
import { memoryCommand, memoryGet } from './editorial-memory-store.ts';
import { generationModel } from './text-generation.ts';
import { FlowError } from './errors.ts';
import { memoryBundle, memoryReadState } from './editorial-memory-detail.ts';
import { verifyMemoryMarketProof } from '../domain/editorial-memory-market-proof.ts';

export async function checkEditorialMemory(id: string, expected: MemoryEvidenceRef, requestId: string): Promise<MemoryJob> {
  memoryIdSchema.parse(id); memoryEvidenceRefSchema.parse(expected);
  return memoryCommand('memory.check', { id, expected }, requestId, 'library.edit', async client => {
    if (!await memoryGet(client, 'evidence', id)) throw new FlowError('NOT_FOUND', 404);
    const bundle = await memoryBundle(client, id, await memoryReadState(client));
    if (bundle.evidence.kind === 'statistic' && bundle.evidence.market?.mapping
      && (!bundle.source || !bundle.material.originalFileId || !verifyMemoryMarketProof(bundle.evidence, bundle.source, bundle.material.originalFileId)))
      throw new FlowError('MEMORY_CONFLICT', 409);
  }, async client => (await client.query('SELECT public.reporter_memory_check_start($1,$2::jsonb,$3) AS value',
    [id, JSON.stringify(expected), generationModel()])).rows[0].value);
}
