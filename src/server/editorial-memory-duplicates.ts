import 'server-only';
import type { PoolClient } from 'pg';
import type { MemoryCitation, MemoryEvidenceRef, MemoryEvidenceView } from '../domain/editorial-memory.ts';
import { memoryEvidenceRef, sameMemoryEvidence } from '../domain/editorial-memory.ts';
import { contentHash } from '../domain/text/hash.ts';
import { memoryDuplicateResolutionSchema, memoryIdSchema } from './editorial-memory-input.ts';
import { memoryBundle, memoryReadState } from './editorial-memory-detail.ts';
import { memoryView } from './editorial-memory-query.ts';
import { memoryCommand, memoryGet } from './editorial-memory-store.ts';
import type { MemoryStored } from './editorial-memory-store.ts';
import { FlowError } from './errors.ts';

function sameOrigin(variant: MemoryStored<MemoryCitation>, canonical: MemoryStored<MemoryCitation>): boolean {
  const a = variant.doc, b = canonical.doc;
  return a.kind === 'citation' && b.kind === 'citation' && Boolean(a.legacy?.article) && a.legacyCitationId === canonical.id
    && b.legacyCitationId === canonical.id && variant.id !== canonical.id && variant.origin_production_id === canonical.origin_production_id
    && variant.parent_id === canonical.parent_id && contentHash(a.anchor) === contentHash(b.anchor)
    && contentHash(a.legacy?.citation.ref) === contentHash(b.legacy?.citation.ref) && a.legacy?.citation.sourceHash === b.legacy?.citation.sourceHash;
}
async function saveDuplicate(client: PoolClient, variant: MemoryStored<MemoryCitation>, canonical: MemoryStored<MemoryCitation>, state: 'pending' | 'superseded',
  reason: string, choice: NonNullable<MemoryCitation['deduplication']>['choice']): Promise<void> {
  const evidence: MemoryCitation = { ...variant.doc, revision: variant.doc.revision + 1, status: state === 'pending' ? 'active' : 'superseded',
    deduplication: { canonicalId: canonical.id, canonical: memoryEvidenceRef(canonical.doc), state, choice, reason, personId: '', at: '' } };
  await client.query('SELECT public.reporter_memory_duplicate_save($1::jsonb,$2::jsonb,$3,$4)', [JSON.stringify({ kind: 'evidence', id: variant.id,
    expected: variant.storage_revision, doc: evidence, fingerprint: memoryEvidenceRef(evidence).hash, parentKind: variant.parent_kind, parentId: variant.parent_id }),
  JSON.stringify(memoryEvidenceRef(canonical.doc)), reason, choice === 'automatic' || choice === 'pending']);
}
/** Exact legacy/production/source identity only. Corrected variants stay visible until an editor chooses. */
export async function reconcileMemoryDuplicate(client: PoolClient, variantId: string, canonicalId: string): Promise<void> {
  const variant = await memoryGet<MemoryCitation>(client, 'evidence', variantId), canonical = await memoryGet<MemoryCitation>(client, 'evidence', canonicalId);
  if (!variant || !canonical || !sameOrigin(variant, canonical) || variant.doc.status !== 'active' || canonical.doc.status !== 'active'
    || variant.doc.deduplication?.canonicalId === canonicalId) return;
  const automatic = memoryEvidenceRef(variant.doc).hash === variant.doc.legacy?.mappedHash
    && variant.doc.legacy?.state === 'synchronized' && canonical.doc.legacy?.state === 'synchronized';
  await saveDuplicate(client, variant, canonical, automatic ? 'superseded' : 'pending', automatic
    ? 'Citação do artigo consolidada com a curadoria da mesma origem.' : 'Escolha a curadoria a preservar antes de consolidar a duplicata.', automatic ? 'automatic' : 'pending');
}
type Resolution = { expected: MemoryEvidenceRef; canonical: MemoryEvidenceRef; choice: 'keep_variant' | 'use_curated'; reason: string };
export async function resolveMemoryDuplicate(id: string, value: Resolution, requestId: string): Promise<MemoryEvidenceView> {
  memoryIdSchema.parse(id); const input = memoryDuplicateResolutionSchema.parse(value);
  return memoryCommand('memory.duplicate.resolve', { id, input }, requestId, 'library.edit', async client => {
    const state = await memoryReadState(client);
    await memoryBundle(client, id, state); await memoryBundle(client, input.canonical.id, state);
  }, async client => {
    const variant = await memoryGet<MemoryCitation>(client, 'evidence', id); let canonical = await memoryGet<MemoryCitation>(client, 'evidence', input.canonical.id);
    if (!variant || !canonical) throw new FlowError('NOT_FOUND', 404);
    if (id !== input.expected.id || !sameMemoryEvidence(input.expected, memoryEvidenceRef(variant.doc))
      || !sameMemoryEvidence(input.canonical, memoryEvidenceRef(canonical.doc))) throw new FlowError('MEMORY_CONFLICT', 409);
    if (!sameOrigin(variant, canonical) || variant.doc.status !== 'active' || canonical.doc.status !== 'active'
      || canonical.doc.legacy?.state !== 'synchronized') throw new FlowError('MEMORY_LEGACY_CONFLICT', 409);
    if (input.choice === 'keep_variant') {
      const next: MemoryCitation = { ...canonical.doc, metadata: variant.doc.metadata, personId: variant.doc.personId, authorConfirmed: variant.doc.authorConfirmed,
        revision: canonical.doc.revision + 1 };
      if (memoryEvidenceRef(next).hash !== memoryEvidenceRef(canonical.doc).hash) canonical = (await client.query(
        'SELECT public.reporter_memory_correct($1,$2,$3::jsonb,$4,$5) AS value', [canonical.id, canonical.storage_revision, JSON.stringify(next), memoryEvidenceRef(next).hash, input.reason])).rows[0].value;
    }
    await saveDuplicate(client, variant, canonical!, 'superseded', input.reason, input.choice);
    return memoryView(await memoryBundle(client, canonical!.id, await memoryReadState(client)));
  });
}
