'use client';

import { ButtonLink, Card, EmptyState, MediaFrame, MetaList, PageHeader, PageStack, SkeletonText } from '@content-ventures/design-system/v3';
import { ArrowRight, CheckCircle2 } from '@content-ventures/design-system/v3/icons';
import { creditLine, imageAlt } from '@/domain';
import type { InProgressItem } from '@/ports';
import { useAsset, useAssetUrl, usePiece, useProduction } from '@/state';
import { PRODUCTIONS_HREF, stepTargetHref } from '@/ui/routes';
import { useNow } from '@/ui/time';
import { inProgressLine } from './desk-copy';

/** The existing "Continue" action, promoted to a visual card; no new draft or workflow state. */
export function FeaturedProduction({ item, loading }: { item: InProgressItem | undefined; loading: boolean }) {
  if (item?.nextStep) return <ProductionCard item={item} />;
  if (loading) {
    return (
      <Card loading aria-label="Carregando produção para continuar" padding="lg">
        <PageStack>
          <MediaFrame ratio="24/9" alt="" state="loading" />
          <SkeletonText lines={2} />
        </PageStack>
      </Card>
    );
  }
  return (
    <Card padding="lg">
      <EmptyState
        size="panel"
        icon={CheckCircle2}
        title="Espaço para a próxima história"
        description="Confira suas prioridades ou comece uma nova produção."
        actions={<ButtonLink href={PRODUCTIONS_HREF}>Ver produções</ButtonLink>}
      />
    </Card>
  );
}

function ProductionCard({ item }: { item: InProgressItem }) {
  const production = useProduction(item.productionId);
  const article = production.data?.pieces.find((piece) => piece.kind === 'article');
  const draft = usePiece(article?.id);
  const cover = draft.data?.body.type === 'article' ? draft.data.body.cover : undefined;
  const asset = useAsset(cover?.assetId);
  const url = useAssetUrl(cover?.assetId);
  const now = useNow();
  const credit = asset.data ? creditLine(asset.data.credit) : undefined;
  const caption = cover ? [cover.caption, credit].filter(Boolean).join(' — ') || undefined : undefined;
  const loading = production.status === 'loading' || (article && draft.status === 'loading') || (cover && url.status === 'loading');
  const step = item.nextStep;

  return (
    <Card as="article" padding="lg" aria-label={`Continuar: ${item.productionTitle}`}>
      <PageStack>
        <MediaFrame
          ratio="24/9"
          src={cover ? url.data : '/editorial/writing.jpg'}
          alt={cover ? imageAlt(cover) : ''}
          state={loading ? 'loading' : undefined}
          caption={caption}
        />
        <PageHeader
          titleAs="h2"
          title={item.productionTitle}
          eyebrow="Continue de onde parou"
          actions={
            step && (
              <ButtonLink href={stepTargetHref(item.productionId, step.target)} icon={ArrowRight} aria-label={`${step.label}: ${item.productionTitle}`}>
                {step.label}
              </ButtonLink>
            )
          }
        />
        <MetaList size="sm" items={[inProgressLine(item, now), item.owner.name]} />
      </PageStack>
    </Card>
  );
}
