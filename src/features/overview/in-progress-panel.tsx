'use client';

import { Card, CardHeader, CardLink, EmptyState, Grid, MediaFrame, MetaList, PageStack, Panel, Prose, Section, SkeletonText, TextLink } from '@content-ventures/design-system/v3';
import type { DeskView, InProgressItem } from '@/ports';
import { PersonAvatar } from '@/ui/person-avatar';
import { PRODUCTIONS_HREF, productionHref, stepTargetHref } from '@/ui/routes';
import { useNow } from '@/ui/time';
import { formatAgo } from '@/ui/approval-copy';
import { storyOpening, useStoryPreview } from './use-story-preview';

function ProductionPreview({ item }: { item: InProgressItem }) {
  const story = useStoryPreview(item);
  const now = useNow();
  const href = item.nextStep ? stepTargetHref(item.productionId, item.nextStep.target) : productionHref(item.productionId);
  return <Card interactive padding="md">
    <PageStack>
      {story.image && <MediaFrame ratio="16/9" src={story.src} alt={story.alt}
        state={story.imageLoading ? 'loading' : undefined} />}
      <CardHeader titleAs="h3" size="md" title={<CardLink href={href}>{item.productionTitle}</CardLink>}
        description={item.situation.line} />
      {story.text && <Prose variant="compact" measure="wide">{storyOpening(story.text, 110)}</Prose>}
      <MetaList size="sm" items={[
        <PersonAvatar key="avatar" person={item.owner} size="xs" decorative />, item.owner.name,
        now ? formatAgo(item.updatedAt, now) : undefined,
      ]} />
    </PageStack>
  </Card>;
}

/** Recent work excludes the production already featured above it. */
export function InProgressPanel({ desk }: { desk: DeskView | undefined }) {
  const featured = desk?.continueWith ?? desk?.inProgress[0];
  const items = desk?.inProgress.filter(item => item.productionId !== featured?.productionId).slice(0, 4);
  return <Panel><Section title="Produções recentes" action={<TextLink size="sm" href={PRODUCTIONS_HREF}>Ver todas</TextLink>}>
    {!desk ? <SkeletonText lines={4} /> : items?.length ? <Grid columns="1:1" collapseBelow={640}>
      {items.map(item => <ProductionPreview key={item.productionId} item={item} />)}
    </Grid> : <EmptyState size="inline" title="Nenhuma outra produção em andamento" />}
  </Section></Panel>;
}
