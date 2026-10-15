'use client';

import { Badge, ButtonLink, Card, CardHeader, EditableTitle, Grid, MediaFrame, MetaList, PageStack, Prose, SkeletonText } from '@content-ventures/design-system/v3';
import { ArrowRight, Plus } from '@content-ventures/design-system/v3/icons';
import type { InProgressItem } from '@/ports';
import { PersonAvatar } from '@/ui/person-avatar';
import { NEW_PRODUCTION_HREF, productionHref, stepTargetHref } from '@/ui/routes';
import { StartWritingButton } from '@/features/new-production/start-writing-button';
import { storyOpening, useStoryPreview } from './use-story-preview';

export function FeaturedProduction({ item, loading }: { item: InProgressItem | undefined; loading: boolean }) {
  if (item) return <ProductionCard item={item} />;
  if (loading) return <Card loading padding="lg" aria-label="Carregando produção para continuar"><SkeletonText lines={5} /></Card>;
  return <Card padding="lg"><Grid columns="3:2" collapseBelow={640} align="start">
    <PageStack>
      <CardHeader titleAs="h2" size="md" title="Sua próxima história começa aqui" />
      <Prose variant="read" measure="wide">Transforme uma transcrição em artigo e carrossel, com revisão em cada etapa.</Prose>
      <MetaList items={[<ButtonLink key="create" href={NEW_PRODUCTION_HREF} variant="primary" icon={Plus}>Começar produção</ButtonLink>, <StartWritingButton key="write" />]} />
    </PageStack>
    <MediaFrame ratio="16/9" src="/editorial/writing.jpg" alt="" />
  </Grid></Card>;
}

function ProductionCard({ item }: { item: InProgressItem }) {
  const story = useStoryPreview(item);
  const step = item.nextStep;
  return <Card as="article" padding="lg" aria-label={`Continuar: ${item.productionTitle}`}>
    <PageStack>
      <CardHeader titleAs="h2" size="md" title="Continuar de onde parou" />
      <Grid columns="3:2" collapseBelow={640} align="start">
        <PageStack>
          <MetaList items={[<Badge key="status" tone="blue" size="sm">{item.situation.line}</Badge>]} />
          <EditableTitle value={story.title} as="h3" size="page" label="Título da produção em destaque" readOnly onCommit={() => undefined} />
          {story.loading ? <SkeletonText lines={2} /> : story.text && <Prose variant="compact" measure="wide">{storyOpening(story.text, 180)}</Prose>}
          <MetaList size="sm" items={[<PersonAvatar key="avatar" person={item.owner} size="xs" decorative />, item.owner.name, story.simulated ? 'Simulação local' : undefined]} />
          <MetaList items={[<ButtonLink key="continue" variant="primary" href={step ? stepTargetHref(item.productionId, step.target) : productionHref(item.productionId)} icon={ArrowRight}
            aria-label={`${step?.label ?? 'Abrir'}: ${item.productionTitle}`}>{step?.label ?? 'Abrir produção'}</ButtonLink>]} />
        </PageStack>
        <MediaFrame ratio="16/9" src={story.image ? story.src : '/editorial/writing.jpg'} alt={story.alt}
          state={story.loading || story.imageLoading ? 'loading' : undefined} caption={story.caption} />
      </Grid>
    </PageStack>
  </Card>;
}
