import 'server-only';
import type { MemoryWritingStatus } from '../ports/editorial-memory.ts';
import { editorialTransaction } from './editorial.ts';
import { memoryIdSchema } from './editorial-memory-input.ts';
import { inspectMemorySources } from './editorial-memory-operation.ts';
import { memoryError } from './editorial-memory-store.ts';
import { FlowError } from './errors.ts';

/** Never writes a use, changes a review or queues provider work. The normal scope hides private pautas. */
export async function readMemoryWritingStatus(productionId: string): Promise<MemoryWritingStatus> {
  memoryIdSchema.parse(productionId);
  try {
    return (await editorialTransaction<MemoryWritingStatus>('runtime', async (_checkpoint, engine, client) => {
      if (!(await engine.queries.get(productionId)).ok) throw new FlowError('NOT_FOUND', 404);
      const record = engine.records.record(productionId);
      if (!record) throw new FlowError('NOT_FOUND', 404);
      return { productionId, updatedAt: record.production.updatedAt, checkedAt: new Date().toISOString(), ...await inspectMemorySources(client, record) };
    }, false, undefined, { productions: [productionId], pipelines: false })).value;
  } catch (error) { return memoryError(error); }
}
