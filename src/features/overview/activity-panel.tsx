'use client';

import { EmptyState, Panel, Section, SkeletonRows, TextLink, Timeline, type TimelineEntry } from '@content-ventures/design-system/v3';
import { Activity } from '@content-ventures/design-system/v3/icons';
import type { ActivityItem } from '@/ports';
import { PersonAvatar } from '@/ui/person-avatar';
import { productionHref } from '@/ui/routes';
import { RelativeTime } from '@/ui/time';

/**
 * "Atividade" (PLAN §3.1): the four most recent semantic events of the workspace (never
 * keystrokes or autosaves) — as tall as the rhythm chart beside it. New events enter at the top
 * in a short cascade (DS Timeline).
 */

const VISIBLE = 4;

function activityEntry(item: ActivityItem): TimelineEntry {
  const entry: TimelineEntry = {
    id: item.id,
    marker: <PersonAvatar person={item.actor} name="Sistema" size="xs" decorative />,
    title: item.summary,
    date: <RelativeTime at={item.at} />,
    dateTime: item.at,
  };
  if (item.productionId && item.productionTitle) {
    entry.description = (
      <TextLink tone="quiet" href={productionHref(item.productionId)}>
        {item.productionTitle}
      </TextLink>
    );
  }
  return entry;
}

export function ActivityPanel({ items, loading }: { items: readonly ActivityItem[] | undefined; loading: boolean }) {
  return (
    <Panel>
      <Section title="Atividade">
        {loading || !items ? (
          <SkeletonRows label="Carregando a atividade" rows={4} rowHeight={44} divided={false} columns={[{ lead: true, sub: '30%' }, { width: 64, align: 'end' }]} />
        ) : items.length === 0 ? (
          <EmptyState icon={Activity} size="inline" title="Nenhuma atividade ainda" />
        ) : (
          <Timeline label="Atividade recente" variant="activity" items={items.slice(0, VISIBLE).map(activityEntry)} />
        )}
      </Section>
    </Panel>
  );
}
