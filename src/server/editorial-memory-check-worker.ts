import 'server-only';
import { z } from 'zod';
import type { MemoryCheck, MemoryEvidence, MemoryMaterial, MemoryPolicy, MemorySupport } from '../domain/editorial-memory.ts';
import { initialMemoryPolicy } from '../domain/editorial-memory.ts';
import type { MemoryJob } from '../ports/editorial-memory.ts';
import { runMemoryCheck } from './editorial-memory-check-pipeline.ts';
import { transaction } from './database.ts';
import { withWorkspaceWork } from './worker-dispatch.ts';
import { bindWorkerJob } from './worker-context.ts';
import { FlowError, safeCode } from './errors.ts';
import { generateStructured } from './text-generation.ts';
import { searchWebEvidence } from './tavily.ts';

export type MemoryCheckClaim = { job: MemoryJob & { _lease: { owner: string; fence: string } }; evidence: MemoryEvidence; material: MemoryMaterial;
  policy: MemoryPolicy | null; previous: Pick<MemoryCheck, 'id' | 'workspaceId' | 'revision'> | null };
export type MemoryChecker = (claim: MemoryCheckClaim, signal: AbortSignal) => Promise<MemoryCheck>;
const check: MemoryChecker = (claim, signal) => {
  const model = claim.job.model;
  if (!model) throw new FlowError('PIPELINE_SNAPSHOT_MISSING', 422);
  return runMemoryCheck(claim.evidence, claim.material, claim.policy ?? initialMemoryPolicy(claim.job.workspaceId), claim.previous, model, claim.job.createdBy, {
    now: () => new Date().toISOString(),
    generate: async (instruction, input, schema, scoped) => {
      const output = await generateStructured('', '', schema, scoped, { model, temperature: 0, maxTokens: 4000, systemPrompt: instruction, userPrompt: JSON.stringify(input) });
      return { value: output.value, model: output.model, provider: output.provider };
    },
    collect: async (query, scoped) => {
      const [internal, external] = await Promise.all([
        transaction('worker', async client => (await client.query('SELECT public.reporter_memory_check_collect($1,$2) AS value', [query, claim.evidence.id])).rows[0].value as MemorySupport[]),
        searchWebEvidence(query, scoped),
      ]);
      return [...internal, ...external.sources.map(source => ({ kind: 'external' as const, url: source.url, title: source.title, excerpt: source.excerpt,
        retrievedAt: new Date().toISOString(), publishedOn: source.publishedOn ?? null, primaryOrigin: `publisher:${new URL(source.url).hostname.replace(/^www\./, '')}`, originStatus: 'unverified' as const }))];
    },
  }, signal);
};
/** Checks commit only to the exact evidence, policy, previous check and generation that were queued. */
export async function runMemoryCheckJob(owner: string, signal: AbortSignal, deadline?: number, provider: MemoryChecker = check): Promise<boolean | 'yield'> {
  if (process.env.REPORTER_MEMORY_MODE !== 'on' || signal.aborted) return false;
  return withWorkspaceWork('any', owner, signal, async scoped => {
    if (deadline !== undefined && deadline - Date.now() < 170000) return 'yield' as const;
    const claim = await transaction('worker', async client => (await client.query('SELECT public.reporter_memory_check_claim($1) AS value', [owner])).rows[0].value as MemoryCheckClaim | null);
    if (!claim) return false;
    if (!claim.job) return true;
    bindWorkerJob(claim.job.createdBy, 'memory', claim.job.id);
    let result: MemoryCheck | null = null, error: string | null = null, terminal = false;
    try { result = await provider(claim, AbortSignal.any([scoped, AbortSignal.timeout(150000)])); scoped.throwIfAborted(); }
    catch (failure) {
      const code = failure instanceof Error && /^MEMORY_CHECK_[A-Z_]+$/.test(failure.message) ? failure.message : failure instanceof z.ZodError ? 'MEMORY_CHECK_INVALID' : safeCode(failure);
      error = /^[A-Z][A-Z0-9_]{0,99}$/.test(code) ? code : 'MEMORY_CHECK_FAILED'; terminal = failure instanceof FlowError && !failure.retryable;
    }
    const finish = () => transaction('worker', client => client.query('SELECT public.reporter_memory_check_finish($1,$2,$3,$4,$5::jsonb,$6,$7)',
      [claim.job.id, owner, claim.job._lease.fence, claim.job.generation, result ? JSON.stringify(result) : null, error, terminal]));
    try { await finish(); }
    catch (failure) {
      if ((failure as Error).message === 'LEASE_LOST') return true;
      if ((failure as Error).message !== 'MEMORY_CHECK_STALE') throw failure;
      result = null; error = 'MEMORY_CHECK_STALE'; terminal = true; await finish();
    }
    return true;
  });
}
