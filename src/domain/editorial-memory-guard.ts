import type { ArticleBody } from './article.ts';
import { memoryEvidenceRef, sameMemoryEvidence, type MemorySourceBinding } from './editorial-memory.ts';
import { memoryWritingOccurrences, type MemoryWritingItem } from './editorial-memory-writing.ts';
import { sourceContentHash, toSourceVersionRef } from './source.ts';
import type { SourceVersionRef } from './refs.ts';
import type { Source } from './source.ts';
import type { Result } from './result.ts';
import { ok, refuse } from './result.ts';

type Reason = 'memory_source_changed' | 'memory_literal_changed' | 'memory_review_changed';
type BoundItem = MemorySourceBinding['items'][number];
export type MemoryArticleProof = { sourceId: string; sourceVersion: number; sourceHash: string; binding: BoundItem;
  blockId: string; from: number; to: number; sourceFrom: number; sourceTo: number };

/** Current eligibility and the exact selected decision are both required at a gated use. */
function currentItem(binding: BoundItem, items: MemoryWritingItem[], workspaceId: string): boolean {
  const current = items.find(item => item.view.evidence.id === binding.selected.evidence.id), view = current?.view;
  return Boolean(current && view && view.evidence.workspaceId === workspaceId && current.policy.workspaceId === workspaceId && view.eligibility.usable && !view.reviewRestricted && view.checkState !== 'outdated' && view.checkState !== 'restricted'
    && sameMemoryEvidence(binding.selected.evidence, memoryEvidenceRef(view.evidence)) && binding.selected.policyRevision === current.policy.revision
    && (binding.selected.check?.id ?? null) === (view.check?.id ?? null) && (binding.selected.check?.revision ?? null) === (view.check?.revision ?? null)
    && binding.selected.decisionId === (view.decision?.id ?? null));
}

/** Generation reads the whole collection: every supplied excerpt must still be authorized. */
export function validateMemoryWritingSources(sources: Source[], items: MemoryWritingItem[], refs: SourceVersionRef[] = sources.map(source => toSourceVersionRef(source))): Result<undefined, Reason> {
  for (const source of sources) {
    if (!source.memory) continue;
    const ref = refs.find(ref => ref.sourceId === source.id); if (!ref) continue;
    const version = source.versions.find(version => version.number === ref.sourceVersion && version.hash === ref.hash);
    const receipt = source.memory.find(receipt => receipt.version.number === version?.number && receipt.version.hash === version?.hash);
    if (!source.rights.authorized || !receipt || !version || sourceContentHash(version.content) !== ref.hash) return refuse('memory_source_changed', 'A fonte do banco mudou ou perdeu a autorização. Confira a seleção.');
    if (receipt.items.some(binding => !currentItem(binding, items, source.workspaceId))) return refuse('memory_review_changed', 'Há evidências do banco que precisam de uma seleção atualizada antes de escrever.');
  }
  return ok(undefined);
}

/** Approval/delivery validate every referenced bank excerpt, retaining only actual occurrences. */
export function validateMemoryArticle(body: ArticleBody, sources: Source[], items: MemoryWritingItem[]): Result<MemoryArticleProof[], Reason> {
  const proofs: MemoryArticleProof[] = [];
  for (const source of sources) {
    if (!source.memory) continue;
    const occurrences = memoryWritingOccurrences(body, source);
    for (const block of body.blocks) for (const ref of block.sourceRefs ?? []) {
      if (ref.sourceId !== source.id) continue;
      const receipt = source.memory.find(receipt => receipt.version.number === ref.sourceVersion);
      if (!source.rights.authorized || !receipt || ref.locator.type !== 'segment') return refuse('memory_source_changed', 'Confira a origem da evidência antes de continuar.');
      const segmentId = ref.locator.segmentId, binding = receipt.items.find(binding => binding.segmentId === segmentId);
      if (!binding || !currentItem(binding, items, source.workspaceId)) return refuse('memory_review_changed', 'Uma evidência usada no artigo mudou ou precisa de revisão. Atualize a seleção.');
      const matching = occurrences.filter(occurrence => occurrence.blockId === block.id && occurrence.sourceVersion === ref.sourceVersion && occurrence.binding.segmentId === segmentId && (binding.kind === 'statistic' || ref.locator.type === 'segment' && occurrence.sourceFrom === (ref.locator.from ?? 0) && occurrence.sourceTo === (ref.locator.to ?? binding.anchor.excerpt.length)));
      if (!matching.length) return refuse('memory_literal_changed', binding.kind === 'statistic'
        ? 'O dado usado perdeu parte do contexto original. Confira número, unidade, período e qualificadores.' : 'A citação usada não corresponde mais ao trecho original. Confira a referência.');
      for (const occurrence of matching) if (!proofs.some(proof => proof.sourceId === source.id && proof.sourceVersion === ref.sourceVersion
        && proof.blockId === block.id && proof.from === occurrence.from && proof.to === occurrence.to && proof.binding.segmentId === segmentId)) {
        proofs.push({ sourceId: source.id, sourceVersion: ref.sourceVersion, sourceHash: receipt.version.hash, binding: structuredClone(binding),
          blockId: block.id, from: occurrence.from, to: occurrence.to, sourceFrom: occurrence.sourceFrom, sourceTo: occurrence.sourceTo });
      }
    }
  }
  return ok(proofs);
}
