'use client';

import { EmptyState, Panel, Section, SkeletonText, TextLink, Timeline } from '@content-ventures/design-system/v3';
import { Clock } from '@content-ventures/design-system/v3/icons';
import type { ActivityItem } from '@/ports';
import { formatAgo } from '@/ui/approval-copy';
import { PersonAvatar } from '@/ui/person-avatar';
import { productionHref } from '@/ui/routes';
import { useNow } from '@/ui/time';

/** The existing workspace events, including updates from other tabs and people. */
export function RecentActivity({ items }: { items: ActivityItem[] | undefined }) {
  const now = useNow();
  return (
    <Panel>
      <Section title="Últimas movimentações">
        {!items ? <SkeletonText lines={4} /> : items.length === 0 ? (
          <EmptyState size="inline" icon={Clock} title="Nenhuma movimentação ainda" />
        ) : (
          <Timeline
            variant="activity"
            label="Últimas movimentações"
            items={items.slice(0, 4).map((item) => ({
              id: item.id,
              title: item.summary,
              description: item.productionId && item.productionTitle ? (
                <TextLink size="sm" href={productionHref(item.productionId)}>{item.productionTitle}</TextLink>
              ) : undefined,
              date: now ? formatAgo(item.at, now) : undefined,
              dateTime: item.at,
              marker: <PersonAvatar person={item.actor} name="Sistema" size="xs" decorative />,
            }))}
          />
        )}
      </Section>
    </Panel>
  );
}
