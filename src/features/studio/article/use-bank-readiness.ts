'use client';
import { useCallback, useMemo } from 'react';
import { toSourceVersionRef } from '@/domain';
import type { MemoryLibrary } from '@/ports/editorial-memory';
import { useMemoryResource } from '@/state/use-memory-library';
import { bankWritingReadiness } from './bank-readiness-model';
import type { StudioInputs } from './studio-types';
import { contentHash } from '@/domain/text/hash';

export function useBankReadiness({ production, sourceDetails, sourceError, draft }: Pick<StudioInputs, 'production' | 'sourceDetails' | 'sourceError' | 'draft'>, canEdit: boolean) {
  const snapshot = useMemo(() => ({ productionId: production.id, updatedAt: production.production.updatedAt,
    sources: (sourceDetails ?? []).filter(detail => detail.source.memory).map(detail => toSourceVersionRef(detail.source)),
    sourceVersions: (sourceDetails ?? []).filter(detail => detail.source.memory).flatMap(detail => detail.source.versions.map(version => toSourceVersionRef(detail.source, version))),
    draft: { pieceId: draft.pieceId, revision: draft.revision, hash: contentHash(draft.body) },
    draftSources: draft.body.type === 'article' ? draft.body.blocks.flatMap(block => block.sourceRefs ?? []) : [],
  }), [production.id, production.production.updatedAt, sourceDetails, draft.pieceId, draft.revision, draft.body]);
  const load = useCallback((port: MemoryLibrary) => port.writingStatus(snapshot.productionId), [snapshot]);
  const resource = useMemoryResource(load, 5000, canEdit && snapshot.sources.length > 0);
  const readiness = bankWritingReadiness(snapshot, resource.data);
  const error = sourceError ? 'Não foi possível conferir as fontes.' : resource.error ? 'Não foi possível conferir as evidências do banco.'
    : snapshot.sources.length && !resource.port ? 'O banco está indisponível para conferir as evidências.' : undefined;
  const reason = !canEdit ? null : error ?? (production.sources.length && !sourceDetails ? 'Carregando as fontes.'
    : readiness.reason);
  return { reason, issue: canEdit ? readiness.issue : undefined, draftIssue: canEdit ? readiness.draftIssue : undefined, error: canEdit ? error : undefined, retry: sourceError?.retry ?? resource.reload };
}
