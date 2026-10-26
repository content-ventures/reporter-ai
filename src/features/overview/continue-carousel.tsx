'use client';
import { useWorkspaceHref } from '@/ui/workspace-navigation';

import { Badge, Card, CardHeader, CardLink, Carousel, Grid, MediaFrame, Meter, MetaList, PageStack, Panel, Prose, Section, SkeletonText } from '@content-ventures/design-system/v3';
import type { SituationStage } from '@/domain';
import type { InProgressItem } from '@/ports';
import { PersonAvatar } from '@/ui/person-avatar';
import { useCan } from '@/state';
import { productionHref, stageHref, stepTargetHref } from '@/ui/routes';
import { NewProductionLink } from '@/features/new-production/new-production-link';
import { StartWritingButton } from '@/features/new-production/start-writing-button';
import { useStoryPreview } from './use-story-preview';

const TITLE = 'Continuar de onde parou';
const PLACEHOLDER = '/editorial/writing.jpg';

const STAGE_LABELS: Readonly<Record<SituationStage, string>> = {
  source: 'Material',
  article: 'Artigo',
  approval: 'Aprovação',
  carousel: 'Carrossel',
  delivery: 'Entrega',
  archived: 'Arquivada',
};
/** The default journey, for the position while the production's own stages load. */
const DEFAULT_JOURNEY: readonly SituationStage[] = ['source', 'article', 'approval', 'carousel', 'delivery'];

/** One card per production in progress, the viewer's next move first; nothing yet: the start card. */
export function ContinueCarousel({ items }: { items: InProgressItem[] | undefined }) {
  if (items && items.length === 0) return <StartCard />;
  return (
    <Panel>
      <Section title={TITLE}>
        {!items ? <SkeletonText lines={6} /> : (
          <Carousel label={TITLE} perView={3}>
            {items.map((item) => <ContinueCard key={item.productionId} item={item} />)}
          </Carousel>
        )}
      </Section>
    </Panel>
  );
}

/** Image, stage, title, where the journey stands and who owns it; the card opens the current stage. */
function ContinueCard({ item }: { item: InProgressItem }) {
  const workspaceHrefFor = useWorkspaceHref();
  const story = useStoryPreview(item);
  const stages = story.detail?.stages;
  const at = stages?.findIndex((stage) => stage.id === story.detail?.currentStageId) ?? -1;
  const position = stages && at >= 0 ? { index: at + 1, total: stages.length } : { index: DEFAULT_JOURNEY.indexOf(item.situation.stage) + 1, total: DEFAULT_JOURNEY.length };
  const href = item.nextStep ? stepTargetHref(item.productionId, item.nextStep.target)
    : story.stage ? stageHref(item.productionId, story.stage) : productionHref(item.productionId);
  return (
    <Card as="article" interactive padding="sm" aria-label={`Continuar: ${item.productionTitle}`}>
      <PageStack>
        <MediaFrame ratio="16/9" src={story.image ? story.src : PLACEHOLDER} alt={story.alt}
          state={story.loading || story.imageLoading ? 'loading' : undefined} />
        {/* One column at the card rhythm (8 px), tighter than the page stack. */}
        <Grid columns="auto" min={1440} gap="sm">
          <MetaList items={[<Badge key="stage" tone="blue" size="sm">{STAGE_LABELS[item.situation.stage]}</Badge>]} />
          <CardHeader titleAs="h3" title={<CardLink href={workspaceHrefFor(href)} aria-label={`Continuar: ${item.productionTitle}`}>{story.title}</CardLink>} />
          {position.index > 0 && (
            <Meter size="sm" value={position.index} max={position.total} label={`Etapa ${position.index} de ${position.total}`} />
          )}
          <MetaList size="sm" separator="" items={[<PersonAvatar key="avatar" person={item.owner} size="xs" decorative />, item.owner.name]} />
        </Grid>
      </PageStack>
    </Card>
  );
}

/** An empty workspace: where the first story starts. */
function StartCard() {
  const creates = useCan('production.create');
  return (
    <Card padding="lg">
      <Grid columns="3:2" collapseBelow={640} align="start">
        <PageStack>
          <CardHeader titleAs="h2" size="md" title="Sua próxima história começa aqui" />
          <Prose variant="read" measure="wide">Transforme uma transcrição em artigo e carrossel, com revisão em cada etapa.</Prose>
          {creates && <MetaList items={[<NewProductionLink key="create" label="Começar produção" />, <StartWritingButton key="write" />]} />}
        </PageStack>
        <MediaFrame ratio="16/9" src={PLACEHOLDER} alt="" />
      </Grid>
    </Card>
  );
}
