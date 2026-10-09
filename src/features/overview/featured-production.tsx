'use client';

import { ButtonLink, Card, CardHeader, EmptyState, Grid, MediaFrame, MetaList, PageStack, SkeletonText, StepperCompact } from '@content-ventures/design-system/v3';
import { ArrowRight, CheckCircle2 } from '@content-ventures/design-system/v3/icons';
import { creditLine, imageAlt } from '@/domain';
import type { InProgressItem } from '@/ports';
import { useAsset, useAssetUrl, usePiece, useProduction } from '@/state';
import { PRODUCTIONS_HREF, stepTargetHref } from '@/ui/routes';
import { useNow } from '@/ui/time';
import { inProgressLine } from './desk-copy';

/** A compact resumption of the real production, with its cover and current R1 journey. */
export function FeaturedProduction({ item, loading }: { item: InProgressItem | undefined; loading: boolean }) {
  if (item?.nextStep) return <ProductionCard item={item} />;
  if (loading) {
    return (
      <Card loading aria-label="Carregando produção para continuar" padding="lg">
        <PageStack>
          <Grid columns="1:2" collapseBelow={false}>
            <MediaFrame ratio="4/3" maxHeight={120} alt="" state="loading" />
            <SkeletonText lines={3} />
          </Grid>
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
  const stages = production.data?.stages;
  const current = stages?.findIndex((stage) => stage.id === production.data?.currentStageId) ?? -1;
  const action = step && (
    <ButtonLink size="sm" href={stepTargetHref(item.productionId, step.target)} icon={ArrowRight} aria-label={`${step.label}: ${item.productionTitle}`}>
      {step.label}
    </ButtonLink>
  );

  return (
    <Card as="article" padding="lg" aria-label={`Continuar: ${item.productionTitle}`}>
      <PageStack>
        <Grid columns="1:2" collapseBelow={false} align="start">
          <MediaFrame
            ratio="4/3"
            maxHeight={120}
            src={cover ? url.data : '/editorial/writing.jpg'}
            alt={cover ? imageAlt(cover) : ''}
            state={loading ? 'loading' : undefined}
            caption={caption}
          />
          <PageStack>
            <CardHeader titleAs="h2" size="md" title={item.productionTitle} description="Continue de onde parou" />
            <MetaList size="sm" items={[inProgressLine(item, now), item.owner.name]} />
          </PageStack>
        </Grid>
        {stages && current >= 0 ? (
          <StepperCompact
            label={`Etapas de ${item.productionTitle}`}
            steps={stages.map((stage) => ({ id: stage.id, label: stage.label, ...(stage.state !== 'current' ? { state: stage.state } : {}) }))}
            current={current}
            showNext={false}
            actions={action}
          />
        ) : (
          <CardHeader title={item.situation.line} actions={action} />
        )}
      </PageStack>
    </Card>
  );
}
