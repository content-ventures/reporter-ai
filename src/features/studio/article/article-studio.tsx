'use client';

import {
  ButtonLink,
  EmptyState,
  ErrorState,
  ListItemSkeleton,
  SkeletonText,
  WorkspaceLayout,
  Prose,
  PageStack,
} from '@content-ventures/design-system/v3';
import { FileText } from '@content-ventures/design-system/v3/icons';
import type { ProductionId, ProductionStatus } from '@/domain';
import { ProductionHeader, useProductionFrame } from '@/features/production/production-frame';
import { usePiece, useSource } from '@/state';
import type { PieceView } from '@/ports';
import { materialHref } from '@/ui/routes';
import { ArticleWorkspace, StudioStatusBadge } from './article-workspace';
import { studioBadge } from './studio-session-model';

/**
 * Estúdio do artigo (`/productions/[id]/article`, PLAN §3.5). Loads the article piece, its
 * working draft and the material, then hands them to the studio frame. The production header
 * lives inside the studio's `WorkspaceLayout`, so the page keeps a single scroll per region.
 */
export function ArticleStudio({ productionId }: { productionId: ProductionId }) {
  const frame = useProductionFrame();
  const production = frame.production.data;
  const piece = production?.pieces.find((entry) => entry.kind === 'article');
  const draft = usePiece(piece?.id);
  const sourceId = production?.sources[0]?.id;
  const source = useSource(sourceId);

  if (frame.production.status === 'ready' && production && !piece) {
    const unauthorized = production.sources.some((entry) => !entry.authorized);
    return (
      <WorkspaceLayout docked header={<ProductionHeader />} mainLabel="Texto">
        <EmptyState
          icon={FileText}
          size="page"
          title={unauthorized ? 'Material ainda não autorizado' : 'Artigo ainda não iniciado'}
          meta={production.guards.pieces.article?.generate.allowed === false ? production.guards.pieces.article.generate.reason : undefined}
          actions={
            <ButtonLink variant="primary" href={materialHref(productionId)}>
              Abrir material
            </ButtonLink>
          }
        />
      </WorkspaceLayout>
    );
  }

  if (draft.status === 'error') {
    return (
      <WorkspaceLayout docked header={<ProductionHeader />} mainLabel="Texto">
        <ErrorState title="Não foi possível abrir o texto" onRetry={draft.retry} size="page" />
      </WorkspaceLayout>
    );
  }

  if (!production || !piece || !draft.data || draft.data.body.type !== 'article') return <StudioSkeleton piece={piece} productionStatus={production?.status} />;

  return (
    <ArticleWorkspace
      key={piece.id}
      production={production}
      piece={piece}
      draft={draft.data}
      source={source.data}
      {...(source.status === 'error' ? { sourceError: { ...(source.error?.code ? { code: source.error.code } : {}), retry: source.retry } } : {})}
    />
  );
}

/** Loading: the frame with the studio's geometry and the article's status (no jump when the text arrives). */
function StudioSkeleton({ piece, productionStatus }: { piece: PieceView | undefined; productionStatus: ProductionStatus | undefined }) {
  const status = piece ? studioBadge(piece, productionStatus) : undefined;
  return (
    <WorkspaceLayout
      docked
      header={<ProductionHeader {...(status ? { status: <StudioStatusBadge badge={status} /> } : {})} />}
      mainLabel="Texto"
      mainFlush
      end={{ label: 'Painel', defaultSize: 360, defaultCollapsed: true, content: <ListItemSkeleton lines={2} /> }}
    >
      <Prose variant="edit" label="Texto do artigo" header={<SkeletonText lines={1} barHeight={22} lastWidth="70%" lineHeight={36} />}>
        <PageStack>
          <SkeletonText lines={4} lineHeight={28} />
          <SkeletonText lines={3} lineHeight={28} />
        </PageStack>
      </Prose>
    </WorkspaceLayout>
  );
}

