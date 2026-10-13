'use client';

import { EditableTitle, MediaFrame, MetaList, PageStack, Panel, Prose, Section, TextLink } from '@content-ventures/design-system/v3';
import type { InProgressItem } from '@/ports';
import { deliveryHref } from '@/ui/routes';
import { ProgressAction } from './next-step-action';
import { storyOpening, useStoryPreview } from './use-story-preview';

/** An existing delivery-stage story, with its real text and images. */
export function ReadyStory({ item }: { item: InProgressItem }) {
  const story = useStoryPreview(item);
  return (
    <Panel>
      <Section title="Na entrega">
        <PageStack>
          {story.image && <MediaFrame ratio="16/9" src={story.src} alt={story.alt} caption={story.caption} state={story.imageLoading ? 'loading' : undefined} />}
          <EditableTitle value={story.title} as="h3" size="page" label="Título do artigo na entrega" readOnly onCommit={() => undefined} />
          {story.text && <Prose variant="compact" measure="wide" align="start">{storyOpening(story.text, 160)}</Prose>}
          <MetaList size="sm" items={[item.owner.name, item.situation.line, story.simulated ? 'Simulação local' : undefined]} />
          <StoryActions item={item} />
        </PageStack>
      </Section>
    </Panel>
  );
}

function StoryActions({ item }: { item: InProgressItem }) {
  return (
    <MetaList items={[
      <TextLink key="read" size="sm" href={`${deliveryHref(item.productionId)}?view=article`}>Ler artigo</TextLink>,
      <ProgressAction key="next" item={item} />,
    ]} />
  );
}
