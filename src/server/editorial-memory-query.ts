import 'server-only';
import type { MemoryCheck, MemoryDecision, MemoryEvidence, MemoryEvidenceView, MemoryMaterial, MemoryPage, MemoryPolicy, MemoryQuery, MemoryUseStage } from '../domain/editorial-memory.ts';
import { initialMemoryPolicy, memoryEligibility } from '../domain/editorial-memory.ts';
import type { Source } from '../domain/source.ts';
import { databasePassword } from './config.ts';
import { reporterDeploymentMode } from './deployment.ts';
import { encodeMemoryCursor, decodeMemoryCursor } from './editorial-memory-cursor.ts';
import { memoryQuerySchema } from './editorial-memory-input.ts';
import { memoryGet, memoryRead } from './editorial-memory-store.ts';
import { currentReporterContext } from './request-context.ts';
import { FlowError } from './errors.ts';

export type MemoryBundle = { evidence: MemoryEvidence; material: MemoryMaterial; check: MemoryCheck | null; decision: MemoryDecision | null;
  policy: MemoryPolicy | null; source: Source | null; relevance: number | null; uses: Record<MemoryUseStage, number>;
  checkState: MemoryEvidenceView['checkState']; reviewRestricted: boolean };
type MemoryQueryResult = { items: MemoryBundle[]; total: number; snapshot: string; next: { key: string; id: string } | null };
export function memoryCursorKey(): string {
  const key = reporterDeploymentMode() === 'local' ? databasePassword('worker') : process.env.REPORTER_MEMORY_CURSOR_KEY?.trim() || process.env.REPORTER_WORKER_PASSWORD?.trim();
  if (!key) throw new FlowError('MEMORY_CURSOR_CONFIGURATION', 503);
  return key;
}
export function memoryView(bundle: MemoryBundle): MemoryEvidenceView {
  const { evidence, material, check, decision, uses } = bundle;
  const policy = bundle.policy ?? initialMemoryPolicy(evidence.workspaceId);
  const eligibility = bundle.source ? memoryEligibility(evidence, bundle.source, policy, check, decision) : { usable: false, reason: 'source_unavailable' as const };
  const blocked = bundle.reviewRestricted || bundle.checkState === 'outdated' || bundle.checkState === 'restricted';
  return { evidence, material: { id: material.id, title: material.title, kind: material.kind, primaryOrigin: material.primaryOrigin }, check, decision, uses,
    checkState: bundle.checkState, reviewRestricted: bundle.reviewRestricted,
    eligibility: blocked && eligibility.usable ? { usable: false, reason: 'review_required' } : eligibility,
    relevance: bundle.relevance === null ? null : { score: bundle.relevance, reason: 'Correspondência dos termos na evidência e nos metadados.' } };
}
export async function queryEditorialMemory(input: MemoryQuery): Promise<MemoryPage<MemoryEvidenceView>> {
  const query = memoryQuerySchema.parse(input), context = currentReporterContext(), key = memoryCursorKey();
  return memoryRead(async client => {
    const state = (await client.query('SELECT public.reporter_memory_context() AS value')).rows[0].value as { snapshot: string; visibility: string };
    const binding = { tenant: context.tenant, workspace: context.portal, actor: context.actor, visibility: state.visibility };
    const decoded = query.cursor ? decodeMemoryCursor(query.cursor, query, binding, key, Date.now()) : null;
    const snapshot = decoded?.snapshot ?? state.snapshot;
    const result = (await client.query('SELECT public.reporter_memory_query($1::jsonb,$2::bigint,$3::jsonb,$4) AS value',
      [JSON.stringify(query), snapshot, decoded ? JSON.stringify(decoded.position) : null, state.visibility])).rows[0].value as MemoryQueryResult;
    return { items: result.items.map(memoryView), total: result.total, snapshot: result.snapshot,
      nextCursor: result.next ? encodeMemoryCursor({ snapshot: result.snapshot, position: result.next }, query, binding, key, Date.now()) : null };
  });
}
export async function readMemoryPolicy(): Promise<MemoryPolicy> {
  return memoryRead(async client => (await memoryGet<MemoryPolicy>(client, 'policy', 'editorial-memory'))?.doc ?? initialMemoryPolicy(currentReporterContext().portal));
}
