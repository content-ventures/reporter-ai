'use client';
import { useCallback, useMemo } from 'react';
import { toSourceVersionRef } from '@/domain';
import type { MemoryLibrary } from '@/ports/editorial-memory';
import { useMemoryResource } from '@/state/use-memory-library';
import { bankWritingReadiness } from './bank-readiness-model';
import type { StudioInputs } from './studio-types';

export function useBankReadiness({ production, sourceDetails, sourceError }: Pick<StudioInputs, 'production' | 'sourceDetails' | 'sourceError'>, canEdit: boolean) {
  const snapshot = useMemo(() => ({ productionId: production.id, updatedAt: production.updatedAt,
    sources: (sourceDetails ?? []).filter(detail => detail.source.memory).map(detail => toSourceVersionRef(detail.source)),
  }), [production.id, production.updatedAt, sourceDetails]);
  const load = useCallback((port: MemoryLibrary) => port.writingStatus(snapshot.productionId), [snapshot]);
  const resource = useMemoryResource(load, 5000, canEdit && snapshot.sources.length > 0);
  const readiness = bankWritingReadiness(snapshot, resource.data);
  const error = sourceError ? 'Não foi possível conferir as fontes.' : resource.error ? 'Não foi possível conferir as evidências do banco.'
    : snapshot.sources.length && !resource.port ? 'O banco está indisponível para conferir as evidências.' : undefined;
  const reason = !canEdit ? null : error ?? (production.sources.length && !sourceDetails ? 'Carregando as fontes.'
    : readiness.reason);
  return { reason, issue: canEdit ? readiness.issue : undefined, error: canEdit ? error : undefined, retry: sourceError?.retry ?? resource.reload };
}
