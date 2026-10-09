'use client';

import { useId, useState } from 'react';
import { Card, EditableTitle, EmptyState, Grid, MetaList, PageStack, Panel, Prose, ScrollArea, Section, SkeletonText, Tabs, TextLink, Tooltip } from '@content-ventures/design-system/v3';
import { Inbox } from '@content-ventures/design-system/v3/icons';
import type { DeskView, InProgressItem, TeamStage } from '@/ports';
import { PRODUCTIONS_HREF } from '@/ui/routes';
import { StatusBadge } from '@/ui/status-badge';
import { useNow } from '@/ui/time';
import { formatAgo } from '@/ui/approval-copy';
import { inProgressSize, TEAM_STAGE_LABELS } from './desk-copy';
import { ProgressAction } from './next-step-action';
import { storyOpening, useStoryPreview } from './use-story-preview';

type DeskTab = 'all' | TeamStage;

/** A preview of the existing team desk, filtered by its real R1 stages. */
export function ProductionDesk({ desk, featuredId }: { desk: DeskView | undefined; featuredId?: string }) {
  const [tab, setTab] = useState<DeskTab>('all');
  const id = useId();
  // Personal work already appears in the continuation and "Em andamento" panels.
  const personal = new Set(desk?.inProgress.map((item) => item.productionId));
  if (featuredId) personal.add(featuredId);
  const groups = desk?.team.map((group) => ({ ...group, items: group.items.filter((item) => !personal.has(item.productionId)) })) ?? [];
  const all = groups.flatMap((group) => group.items);
  const items = (tab === 'all' ? all : groups.find((group) => group.stage === tab)?.items ?? [])
    .toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const preview = items.slice(0, 4);
  const panelId = `${id}-${tab}`;
  const tabs = [
    { value: 'all' as const, label: 'Todas', count: all.length, panelId: `${id}-all` },
    ...groups.map((group) => ({ value: group.stage, label: TEAM_STAGE_LABELS[group.stage], count: group.items.length, panelId: `${id}-${group.stage}` })),
  ];

  return (
    <Panel>
      <Section
        title="Histórias da redação"
        meta={desk && items.length > preview.length ? `${preview.length} de ${items.length}` : undefined}
        action={<TextLink size="sm" href={PRODUCTIONS_HREF}>Ver todas</TextLink>}
      >
        <PageStack>
          {desk && <Tabs<DeskTab> label="Produções por etapa" size="sm" items={tabs} value={tab} onChange={setTab} />}
          <PageStack role={desk ? 'tabpanel' : undefined} id={panelId} aria-labelledby={desk ? `${panelId}-tab` : undefined}>
            {desk && preview.length === 0 ? (
              <EmptyState size="inline" icon={Inbox} title={tab === 'all' ? 'Nenhuma outra produção' : 'Nenhuma produção nesta etapa'} />
            ) : (
              <Grid columns="auto" min={250} gap="sm" label="Histórias da redação">
                {desk ? preview.map((item) => <ProductionPreview key={item.productionId} item={item} />) : [0, 1, 2, 3].map((index) => (
                  <SkeletonText key={index} lines={5} />
                ))}
              </Grid>
            )}
          </PageStack>
        </PageStack>
      </Section>
    </Panel>
  );
}

/** Existing status vocabulary, ownership and next action, without another workflow model. */
function ProductionPreview({ item }: { item: InProgressItem }) {
  const now = useNow();
  const story = useStoryPreview(item);
  const piece = story.currentPiece;
  return (
    <Card as="article" padding="sm" aria-label={item.productionTitle}>
      <Prose variant="compact" align="start" measure="wide">
        <MetaList size="xs" wrap={false} items={[
          piece ? <StatusBadge key="status" kind="piece" status={piece.status} size="sm" /> : story.detail && <StatusBadge key="status" kind="production" status={story.detail.status} size="sm" />,
          story.stage?.label ?? item.situation.line,
        ]} />
        <ScrollArea height={60} fade={false} label={`Título: ${story.title}`}>
          <Tooltip content={story.title}>
            <EditableTitle value={storyOpening(story.title, 85) ?? story.title} as="h3" size="card" label="Título da história" readOnly onCommit={() => undefined} />
          </Tooltip>
        </ScrollArea>
        <ScrollArea height={40} fade={false} label={`Abertura: ${item.productionTitle}`}>
          {story.loading ? <SkeletonText lines={2} /> : storyOpening(story.text, 75)}
        </ScrollArea>
        <ScrollArea height={32} fade={false} label={`Autoria e atualização: ${item.productionTitle}`}>
          <MetaList size="xs" wrap={false} items={[
            item.owner.name,
            now ? formatAgo(item.updatedAt, now) : undefined,
          ]} />
          <MetaList size="xs" wrap={false} items={[
            inProgressSize(item),
            story.simulated ? 'Simulação local' : undefined,
          ]} />
        </ScrollArea>
        <ProgressAction item={item} />
      </Prose>
    </Card>
  );
}
