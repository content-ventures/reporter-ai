'use client';

import { newsLogoUrl } from '@/domain/news-branding';

import {
  Badge,
  BarChart,
  BrandMark,
  ChartCard,
  IconButton,
  Legend,
  List,
  ListItem,
  PageStack,
  Panel,
  Section,
  Sparkline,
} from '@content-ventures/design-system/v3';
import { RefreshCw } from '@content-ventures/design-system/v3/icons';
import { PRIORITY_LABELS } from '@/domain/hard-news';
import type { NewsFeed, NewsItem } from '@/domain/hard-news';
import { useHardNews } from '../state/hard-news-provider';
import { feedRows, hourly, hourlyArrivals, PRIORITY_COLOR, waitLabel } from './radar-model';

const SERIES = (['high', 'medium', 'low'] as const).map((key) => ({ key, label: PRIORITY_LABELS[key], color: PRIORITY_COLOR[key] }));
const ARRIVALS = [{ key: 'all', label: 'Notícias', color: 'blue' as const }];

/** The radar's instruments: the flow of the last 12 hours and the health of every source. */
export function RadarSide({ triage = true, news, feeds, now }: { triage?: boolean; news: readonly NewsItem[]; feeds: readonly NewsFeed[]; now: number }) {
  const buckets: { label: string; title: string; values: Record<string, number> }[] = triage ? hourly(news, now) : hourlyArrivals(news, now);
  const active = feeds.filter((feed) => feed.state === 'active').length;
  return (
    <PageStack>
      <ChartCard
        title="Chegadas"
        titleAs="h2"
        description="Últimas 12 h"
        legend={triage ? <Legend items={SERIES.map((series) => ({ key: series.key, label: series.label, color: series.color }))} /> : undefined}
      >
        <BarChart
          label="Notícias por hora"
          data={buckets.map((bucket) => ({ label: bucket.label, title: bucket.title, values: bucket.values }))}
          series={triage ? SERIES : ARRIVALS}
          layout="stacked"
          values="none"
          appearance="solid"
          height={132}
          xTicks={[0, 4, 8, 11]}
        />
      </ChartCard>
      <Panel label="Fontes">
        <Section title="Fontes" meta={`${active} de ${feeds.length} ativas`}>
          <List label="Fontes" framed={false} bleed>
            {feedRows(feeds).map((feed) => <FeedRow key={feed.id} feed={feed} now={now} />)}
          </List>
        </Section>
      </Panel>
    </PageStack>
  );
}

function FeedRow({ feed, now }: { feed: NewsFeed; now: number }) {
  const { actions } = useHardNews();
  const description = feed.state === 'failing'
    ? `Sem resposta ${feed.lastReadAt ? waitLabel(feed.lastReadAt, now) : ''}`.trim()
    : `${feed.lastReadAt ? `Lida ${waitLabel(feed.lastReadAt, now)}` : 'Ainda não lida'} · ${feed.lastDay} em 24 h`;
  return (
    <ListItem
      density="sm"
      leading={<BrandMark name={feed.name} src={newsLogoUrl(feed.site ?? feed.url)} size="sm" decorative />}
      title={feed.name}
      description={description}
      meta={feed.state === 'failing'
        ? <Badge variant="text" tone="red" dot>Falha</Badge>
        : feed.state === 'paused'
          ? <Badge variant="text" tone="gray" dot="hollow">Pausada</Badge>
          : feed.lastWeek && feed.lastWeek.length > 1
            ? <Sparkline points={feed.lastWeek} tone="gray" width={64} height={24} />
            : undefined}
      actions={feed.state === 'failing'
        ? <IconButton variant="ghost" size="sm" icon={RefreshCw} label={`Tentar ler ${feed.name} de novo`} onClick={() => void actions.retryFeed(feed.id)} />
        : undefined}
    />
  );
}
