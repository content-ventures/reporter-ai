'use client';

import { ButtonLink, EmptyState, WorkspaceLayout } from '@content-ventures/design-system/v3';
import { Lock } from '@content-ventures/design-system/v3/icons';
import type { PieceView, ProductionDetail } from '@/ports';
import { ProductionHeader } from '@/features/production/production-frame';
import { pieceHref, reviewHref } from '@/ui/routes';
import { StatusBadge } from '@/ui/status-badge';

/**
 * Carousel stage before the article is approved (PLAN §3.7, states matrix "etapa bloqueada com
 * motivo"): the reason from the derive guard and the one action that moves the gate forward.
 */
export function CarouselBlocked({ production, article }: { production: ProductionDetail; article: PieceView | undefined }) {
  const guard = production.guards.derive.carousel;
  const reason = guard && !guard.allowed ? guard.reason : 'Disponível após aprovar o artigo.';
  const inReview = article?.status === 'in_review';
  return (
    <WorkspaceLayout docked header={<ProductionHeader compact />} mainLabel="Carrossel">
      <EmptyState
        icon={Lock}
        size="page"
        title={reason}
        meta={
          article ? (
            <>
              {['Artigo', article.latestVersion?.label].filter(Boolean).join(' ')}{' '}
              <StatusBadge kind="piece" status={article.status} variant="text" />
            </>
          ) : undefined
        }
        actions={
          inReview ? (
            <ButtonLink href={reviewHref(production.id, 'article')} variant="primary">
              Abrir revisão
            </ButtonLink>
          ) : (
            <ButtonLink href={pieceHref(production.id, 'article')} variant="primary">
              Abrir artigo
            </ButtonLink>
          )
        }
      />
    </WorkspaceLayout>
  );
}
