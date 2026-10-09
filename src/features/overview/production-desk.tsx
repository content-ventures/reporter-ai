'use client';

import { useId, useState } from 'react';
import { Card, CardHeader, EmptyState, Grid, MetaList, PageStack, Panel, Section, SkeletonText, Tabs, TextLink } from '@content-ventures/design-system/v3';
import { Inbox } from '@content-ventures/design-system/v3/icons';
import type { DeskView, InProgressItem, TeamStage } from '@/ports';
import { useProduction } from '@/state';
import { PersonAvatar } from '@/ui/person-avatar';
import { PRODUCTIONS_HREF } from '@/ui/routes';
import { StatusBadge } from '@/ui/status-badge';
import { useNow } from '@/ui/time';
import { formatAgo } from '@/ui/approval-copy';
import { inProgressSize, TEAM_STAGE_LABELS } from './desk-copy';
import { ProgressAction } from './next-step-action';

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
        title="Outras produções"
        meta={desk && items.length > preview.length ? `${preview.length} de ${items.length}` : undefined}
        action={<TextLink size="sm" href={PRODUCTIONS_HREF}>Ver todas</TextLink>}
      >
        <PageStack>
          {desk && <Tabs<DeskTab> label="Produções por etapa" size="sm" items={tabs} value={tab} onChange={setTab} />}
          <PageStack role={desk ? 'tabpanel' : undefined} id={panelId} aria-labelledby={desk ? `${panelId}-tab` : undefined}>
            {desk && preview.length === 0 ? (
              <EmptyState size="inline" icon={Inbox} title={tab === 'all' ? 'Nenhuma outra produção' : 'Nenhuma produção nesta etapa'} />
            ) : (
              <Grid columns="auto" min={250} gap="md" as="ul" label="Outras produções">
                {desk ? preview.map((item) => <ProductionPreview key={item.productionId} item={item} />) : [0, 1, 2, 3].map((index) => (
                  <Card key={index} loading padding="md"><SkeletonText lines={4} /></Card>
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
  const production = useProduction(item.productionId);
  const detail = production.data;
  const currentStage = detail?.stages.find((stage) => stage.id === detail.currentStageId);
  const piece = detail?.pieces.find((piece) => piece.kind === currentStage?.pieceKind);
  return (
    <Card as="article" padding="md" aria-label={item.productionTitle}>
      <PageStack>
        <CardHeader title={item.productionTitle} size="md" description={item.owner.name} leading={<PersonAvatar person={item.owner} size="sm" decorative />} />
        <MetaList size="sm" items={[
          piece ? <StatusBadge key="status" kind="piece" status={piece.status} size="sm" /> : detail && <StatusBadge key="status" kind="production" status={detail.status} size="sm" />,
          currentStage?.label ?? item.situation.line,
          inProgressSize(item),
          now ? formatAgo(item.updatedAt, now) : undefined,
        ]} />
        <ProgressAction item={item} />
      </PageStack>
    </Card>
  );
}
