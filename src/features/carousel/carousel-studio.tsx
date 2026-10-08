'use client';

import { useState } from 'react';
import { ButtonLink, EmptyState, SkeletonText, SlideStrip, WorkspaceLayout } from '@content-ventures/design-system/v3';
import { Presentation } from '@content-ventures/design-system/v3/icons';
import { isRunActive, type ProductionId, type RunId } from '@/domain';
import type { PieceView, ProductionDetail } from '@/ports';
import { usePiece, useRun } from '@/state';
import { ProductionHeader, useProductionFrame } from '@/features/production/production-frame';
import { pieceHref } from '@/ui/routes';
import { CarouselBlocked } from './carousel-blocked';
import { CarouselStart } from './carousel-start';
import { CarouselWorkspace } from './carousel-workspace';
import { SlideImage } from './slide-media';

/**
 * Estúdio do carrossel (`/productions/[id]/carousel`, PLAN §3.7). One route, four moments:
 * blocked until the article is approved, the start page (template, slide count, live cover),
 * the copy run streaming slides, and the studio itself. Creatives are rendered as PNG from
 * template data; the DS only frames them.
 */
export function CarouselStudio({ productionId }: { productionId: ProductionId }) {
  const frame = useProductionFrame();
  const production = frame.production.data;
  const [started, setStarted] = useState<{ productionId: ProductionId; runId: RunId } | null>(null);
  const startedRunId = started?.productionId === productionId ? started.runId : undefined;
  const onRunStarted = (runId: RunId) => setStarted({ productionId, runId });

  if (!production) return <StudioLoading />;

  const article = production.pieces.find((piece) => piece.kind === 'article');
  const carousel = production.pieces.find((piece) => piece.kind === 'carousel');

  if (!production.plan.includes('carousel')) {
    return (
      <WorkspaceLayout docked header={<ProductionHeader compact />} mainLabel="Carrossel">
        <EmptyState
          icon={Presentation}
          size="page"
          title="Esta produção não tem carrossel"
          actions={
            <ButtonLink href={pieceHref(production.id, 'article')} variant="primary">
              Abrir artigo
            </ButtonLink>
          }
        />
      </WorkspaceLayout>
    );
  }
  if (!carousel) {
    return article?.approvedVersion ? (
      <CarouselStart production={production} article={article} onRunStarted={onRunStarted} />
    ) : (
      <CarouselBlocked production={production} article={article} />
    );
  }
  return <ExistingCarousel production={production} article={article} carousel={carousel} startedRunId={startedRunId} onRunStarted={onRunStarted} />;
}

/** A carousel piece exists: the studio, or the start page while it has no slide and no run. */
function ExistingCarousel({
  production,
  article,
  carousel,
  startedRunId,
  onRunStarted,
}: {
  production: ProductionDetail;
  article: PieceView | undefined;
  carousel: PieceView;
  startedRunId: RunId | undefined;
  onRunStarted: (runId: RunId) => void;
}) {
  const piece = usePiece(carousel.id);
  const started = useRun(startedRunId);
  const startedActive = started.status === 'ready' && isRunActive(started.data.fold.run);
  const empty = piece.data?.body.type === 'carousel' && piece.data.body.slides.length === 0;
  if (empty && article?.approvedVersion && !carousel.activeRun && !startedActive) {
    return (
      <CarouselStart
        production={production}
        article={article}
        carousel={carousel}
        draft={piece.data}
        lastRun={carousel.lastRun?.kind === 'carousel.generate' ? carousel.lastRun : undefined}
        onRunStarted={onRunStarted}
      />
    );
  }
  return <CarouselWorkspace production={production} carousel={carousel} article={article} startedRunId={startedRunId} onRunStarted={onRunStarted} />;
}

function StudioLoading() {
  return (
    <WorkspaceLayout
      docked
      header={<ProductionHeader compact />}
      mainLabel="Slide"
      start={{ label: 'Slides', defaultSize: 296, min: 260, max: 360, content: <SlideStrip label="Slides do carrossel" items={[]} value={null} onChange={() => undefined} loading /> }}
      end={{ label: 'Texto', defaultSize: 336, min: 300, max: 480, content: <SkeletonText lines={6} label="Carregando slide" /> }}
    >
      <SlideImage render={undefined} ratio="4/5" alt="Carregando slide" fitHeight />
    </WorkspaceLayout>
  );
}
