import 'server-only';
import { randomUUID } from 'node:crypto';
import type { MemoryDecision, MemoryEvidence, MemoryDecisionInput } from '../domain/editorial-memory.ts';
import { initialMemoryPolicy, reviewMemoryEvidence } from '../domain/editorial-memory.ts';
import { memoryDecisionInputSchema, memoryIdSchema } from './editorial-memory-input.ts';
import { memoryBundle, memoryReadState } from './editorial-memory-detail.ts';
import type { MemoryBundle } from './editorial-memory-query.ts';
import { memoryCommand, memoryPut } from './editorial-memory-store.ts';
import { currentReporterContext } from './request-context.ts';
import { FlowError } from './errors.ts';

export async function reviewEditorialMemory(id: string, value: MemoryDecisionInput, requestId: string): Promise<MemoryDecision> {
  memoryIdSchema.parse(id);
  const input = memoryDecisionInputSchema.parse(value), context = currentReporterContext();
  let bundle: MemoryBundle;
  return memoryCommand('memory.review', { id, input }, requestId, 'library.review', async client => {
    bundle = await memoryBundle(client, id, await memoryReadState(client));
    if (bundle.checkState === 'restricted' || bundle.reviewRestricted) throw new FlowError('MEMORY_REVIEW_RESTRICTED', 403);
    for (const support of input.supports) {
      if (support.kind !== 'internal') continue;
      const saved = (await client.query('SELECT public.reporter_memory_support($1::jsonb) AS value', [JSON.stringify(support.evidence)])).rows[0].value as {
        evidence: MemoryEvidence; primaryOrigin: string } | null;
      if (!saved) throw new FlowError('FORBIDDEN', 403);
      if (saved.primaryOrigin !== support.primaryOrigin || !saved.evidence.anchor.excerpt.includes(support.excerpt)) throw new FlowError('INVALID_INPUT', 422);
    }
  }, async client => {
    if (bundle.checkState === 'outdated') throw new FlowError('MEMORY_CHECK_OUTDATED', 409);
    if (!bundle.source) throw new FlowError('NOT_FOUND', 404);
    const decision = reviewMemoryEvidence(input, bundle.evidence, bundle.source, bundle.policy ?? initialMemoryPolicy(context.portal), bundle.check, bundle.decision,
      { personId: context.actor, workspaceId: context.portal, roles: context.roles },
      { actorId: context.actor, now: new Date().toISOString(), newId: prefix => `${prefix}-${randomUUID()}` });
    if (!decision.ok) {
      const error = new FlowError(decision.refusal.code === 'conflict' ? 'MEMORY_CONFLICT' : 'INVALID_INPUT', decision.refusal.code === 'conflict' ? 409 : 422);
      error.reason = decision.refusal.message; throw error;
    }
    return (await memoryPut(client, { kind: 'decision', id: decision.value.id, expected: null, parentKind: 'evidence', parentId: id, doc: decision.value })).doc;
  });
}
