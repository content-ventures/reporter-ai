'use client';

import { AccessState } from '@content-ventures/design-system/v3';
import type { PieceKind, ProductionId } from '@/domain';
import { CarouselStudio } from '@/features/carousel/carousel-studio';
import { ArticleStudio } from './article/article-studio';

/**
 * `[piece]` dispatcher: one studio per piece kind of the registry. R1 has the article and the
 * carousel; later kinds (cut, stories…) add a case here and their own studio.
 */
export function StudioRoute({ productionId, pieceKind }: { productionId: ProductionId; pieceKind: PieceKind }) {
  switch (pieceKind) {
    case 'article':
      return <ArticleStudio productionId={productionId} />;
    case 'carousel':
      return <CarouselStudio productionId={productionId} />;
    default:
      return <AccessState kind="not-found" title="Peça não disponível nesta versão" size="panel" />;
  }
}
