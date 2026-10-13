'use client';

import { ButtonLink, Card, CardHeader, EditableTitle, EmptyState, Grid, MediaFrame, MetaList, Overline, PageStack, Prose, SkeletonText } from '@content-ventures/design-system/v3';
import { ArrowRight, CheckCircle2 } from '@content-ventures/design-system/v3/icons';
import type { InProgressItem } from '@/ports';
import { PersonAvatar } from '@/ui/person-avatar';
import { PRODUCTIONS_HREF, stepTargetHref } from '@/ui/routes';
import { useNow } from '@/ui/time';
import { inProgressLine } from './desk-copy';
import { storyOpening, useStoryPreview } from './use-story-preview';

/** Lead with the writer's actual headline and opening; the action stays on the R1 journey. */
export function FeaturedProduction({ item, loading }: { item: InProgressItem | undefined; loading: boolean }) {
  if (item?.nextStep) return <ProductionCard item={item} />;
  if (loading) {
    return (
      <Card loading aria-label="Carregando produção para continuar" padding="lg">
        <PageStack>
          <Grid columns="1:1" collapseBelow={640}>
            <MediaFrame ratio="4/3" alt="" state="loading" />
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
  const story = useStoryPreview(item);
  const now = useNow();
  const step = item.nextStep;
  const action = step && (
    <ButtonLink size="sm" href={stepTargetHref(item.productionId, step.target)} icon={ArrowRight} aria-label={`${step.label}: ${item.productionTitle}`}>
      {step.label}
    </ButtonLink>
  );

  return (
    <Card as="article" padding="lg" aria-label={`Continuar: ${item.productionTitle}`}>
      <PageStack>
        <Overline>Continue de onde parou</Overline>
        <Grid columns="1:1" collapseBelow={640} align="start">
          <MediaFrame
            ratio="4/3"
            src={story.image ? story.src : '/editorial/writing.jpg'}
            alt={story.alt}
            state={story.loading || story.imageLoading ? 'loading' : undefined}
            caption={story.caption}
          />
          <PageStack>
            <EditableTitle value={story.title} as="h2" size="document" label="Título do artigo em edição" readOnly onCommit={() => undefined} />
            {story.loading ? <SkeletonText lines={3} /> : story.text && (
              <Prose variant="read" size="sm" align="start" measure="wide" label="Abertura do artigo em edição">{storyOpening(story.text, 290)}</Prose>
            )}
            <MetaList size="sm" items={[story.simulated ? 'Simulação local' : undefined]} />
          </PageStack>
        </Grid>
        <CardHeader title={item.owner.name} titleAs="h3" leading={<PersonAvatar person={item.owner} size="sm" decorative />} description={inProgressLine(item, now)} actions={action} />
      </PageStack>
    </Card>
  );
}
