import 'server-only';
import { z } from 'zod';
import { initialMemoryPolicy, memoryEvidenceRef, type MemoryPolicy } from '../domain/editorial-memory.ts';
import { memorySourceSegment } from '../domain/editorial-memory-excerpt.ts';
import { memorySelectedItemCurrent } from '../domain/editorial-memory-guard.ts';
import { memoryOriginalContext } from '../domain/editorial-memory-original.ts';
import { contentHash } from '../domain/text/hash.ts';
import { toSourceVersionRef, type Source } from '../domain/source.ts';
import type { MemorySelectedContext, MemorySelectedContextInput } from '../ports/editorial-memory.ts';
import { editorialTransaction } from './editorial.ts';
import { memoryBundle, memoryReadState } from './editorial-memory-detail.ts';
import { memoryIdSchema } from './editorial-memory-input.ts';
import { memoryView } from './editorial-memory-query.ts';
import { memoryError } from './editorial-memory-store.ts';
import { FlowError } from './errors.ts';
import { memoryPolicyView } from './editorial-memory-policy-view.ts';

export const memorySelectedContextSchema = z.object({ sourceId: memoryIdSchema,
  sourceVersion: z.number().int().positive(), segmentId: memoryIdSchema }).strict();
type StoredContext = Pick<MemorySelectedContext, 'binding' | 'selection' | 'snapshot' | 'evidence' | 'material' | 'check' | 'decision' | 'checkRestricted' | 'decisionRestricted'> & { source: Source; policy: MemoryPolicy | null };

/** Selected historical proof stays separate from current usability and never writes or queues work. */
export async function readMemorySelectedContext(productionId: string, value: MemorySelectedContextInput): Promise<MemorySelectedContext> {
  memoryIdSchema.parse(productionId); const input = memorySelectedContextSchema.parse(value);
  try {
    return (await editorialTransaction<MemorySelectedContext>('runtime', async (_checkpoint, engine, client) => {
      if (!(await engine.queries.get(productionId)).ok) throw new FlowError('NOT_FOUND', 404);
      const record = engine.records.record(productionId), collection = record?.sources.find(source => source.id === input.sourceId);
      const binding = collection && memorySourceSegment(collection, input.sourceVersion, input.segmentId);
      if (!record || !collection || !binding) throw new FlowError('NOT_FOUND', 404);
      const stored = (await client.query('SELECT public.reporter_memory_selected_context($1,$2,$3,$4) AS value',
        [productionId, input.sourceId, input.sourceVersion, input.segmentId])).rows[0].value as StoredContext | null;
      if (!stored || contentHash(stored.binding) !== contentHash(binding)) throw new FlowError('NOT_FOUND', 404);
      const original = memoryOriginalContext(stored.source, binding.anchor);
      if (!original) throw new FlowError('NOT_FOUND', 404);
      const current = await memoryBundle(client, binding.selected.evidence.id, await memoryReadState(client)), view = memoryView(current);
      const policy = current.policy ?? initialMemoryPolicy(collection.workspaceId);
      const matchesSelection = memorySelectedItemCurrent(binding, [{ view, policy }], collection.workspaceId);
      const selectedPolicy = stored.policy ?? initialMemoryPolicy(collection.workspaceId);
      if (selectedPolicy.revision !== binding.selected.policyRevision) throw new FlowError('NOT_FOUND', 404);
      const selection = stored.selection;
      return { productionId, collection: toSourceVersionRef(collection, collection.versions.find(version => version.number === input.sourceVersion)!),
        segmentId: input.segmentId, binding: stored.binding, snapshot: stored.snapshot,
        selection: { id: selection.id, revision: selection.revision, createdAt: selection.createdAt, createdBy: selection.createdBy, updatedAt: selection.updatedAt, updatedBy: selection.updatedBy },
        evidence: stored.evidence, material: stored.material, policy: memoryPolicyView(selectedPolicy), check: stored.check, decision: stored.decision,
        checkRestricted: stored.checkRestricted, decisionRestricted: stored.decisionRestricted,
        original: { ref: binding.anchor.source, authorized: stored.source.rights.authorized, ...original },
        current: { evidence: memoryEvidenceRef(current.evidence), usable: view.eligibility.usable, matchesSelection },
        readOnly: input.sourceVersion !== collection.versions.at(-1)!.number || !collection.rights.authorized || !stored.source.rights.authorized || !matchesSelection };
    }, false, undefined, { productions: [productionId], pipelines: false })).value;
  } catch (error) { return memoryError(error); }
}
