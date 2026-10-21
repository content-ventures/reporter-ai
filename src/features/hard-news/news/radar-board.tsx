'use client';

import Link from 'next/link';
import {
  Button,
  EmptyState,
  Grid,
  List,
  ListItemSkeleton,
  MetricStrip,
  PageStack,
  Section,
} from '@content-ventures/design-system/v3';
import type { MetricProps } from '@content-ventures/design-system/v3';
import { Telescope } from '@content-ventures/design-system/v3/icons';
import { sourceForNews } from '@/domain/news-source-match';
import type { NewsFeed, NewsItem } from '@/domain/hard-news';
import { NEWS_SOURCES_HREF } from '../routes';
import { HEADLINE_MIN_WIDTH, HeadlineCard } from './headline-card';
import { arrivedAt, intakePulse, sinceLabel, waitLabel } from './radar-model';
import type { Pulse, WireGroup } from './radar-model';
import { RadarSide } from './radar-side';
import { TopicRadar } from './topic-radar';
import type { NewsTopic } from './topic-model';
import { NewsEdition } from './news-edition';

export type RadarBoardProps = {
  /** The AI's triage exists (the simulation): "Cobrir agora", priorities and the day's goal. */
  triage: boolean;
  edition: boolean;
  ordered: NewsItem[];
  tab: 'open' | 'decided';
  now: number;
  news: readonly NewsItem[];
  feeds: readonly NewsFeed[];
  pulse: Pulse;
  seenSince: string;
  goal: { covered: number; perDay: number };
  hero: NewsItem[];
  overflow: number;
  groups: WireGroup[];
  decided: NewsItem[];
  query: string;
  topics: NewsTopic[];
  topic?: Pick<NewsTopic, 'key' | 'label'>;
  onTopic: (topic: NewsTopic) => void;
  onClearTopic: () => void;
  selectedId?: string;
  onSelect: (id: string) => void;
  visibleCount: number;
  onLoadMore: () => void;
  onEditGoal: () => void;
  onClearFilters: () => void;
};

/** The first view is a full-width edition of headlines, never an automatically opened story. */
export function RadarBoard(props: RadarBoardProps) {
  const { tab, now, feeds, ordered: items, query, onSelect, onClearFilters } = props;
  if (props.edition && items.length) return <PageStack data-testid="news-headlines">
    <NewsEdition items={items} feeds={feeds} now={now} triage={props.triage} topics={props.topics} onTopic={props.onTopic}
      onSelect={onSelect} limit={props.visibleCount} onLoadMore={props.onLoadMore} />
  </PageStack>;
  return <PageStack data-testid="news-headlines">
    {tab === 'open' ? <TopicRadar topics={props.topics} active={props.topic?.key} onSelect={props.onTopic} onClear={props.onClearTopic} /> : null}
    <Headlines visibleCount={props.visibleCount} onLoadMore={props.onLoadMore} topic={tab === 'open' ? props.topic : undefined} onClearTopic={props.onClearTopic}
      items={items} feeds={feeds} now={now} tab={tab} query={query} onSelect={onSelect} onClearFilters={onClearFilters} />
  </PageStack>;
}

function Headlines({ items, feeds, now, tab, query, onSelect, onClearFilters, visibleCount: limit, onLoadMore, topic, onClearTopic }: Pick<RadarBoardProps, 'feeds' | 'now' | 'tab' | 'query' | 'onSelect' | 'onClearFilters' | 'visibleCount' | 'onLoadMore' | 'topic' | 'onClearTopic'> & { items: NewsItem[] }) {
  if (!items.length) return <EmptyQueue query={query} onClearFilters={onClearFilters} decided={tab === 'decided'} />;
  const card = (item: NewsItem) => <HeadlineCard key={item.id} item={item}
    rating={sourceForNews(item, feeds)?.rating} now={now} onSelect={onSelect} />;
  return <Section title={tab === 'open' ? topic ? `${topic.label} · últimas 24 h` : 'Últimas manchetes' : 'Notícias decididas'} meta={`${items.length} ${items.length === 1 ? 'notícia' : 'notícias'}`}
    action={topic ? <Button variant="ghost" size="sm" onClick={onClearTopic}>Limpar assunto</Button> : undefined}>
      <PageStack>
        <Grid as="section" label="Manchetes" columns="auto" min={HEADLINE_MIN_WIDTH} gap="sm">
          {items.slice(0, limit).map(item => card(item))}
        </Grid>
        {items.length > limit ? <Button variant="secondary" onClick={onLoadMore}>Carregar mais manchetes</Button> : null}
      </PageStack>
    </Section>;
}

/** Collection health stays available without competing with editorial decisions. */
export function RadarActivity(props: RadarBoardProps) {
  return <PageStack>
    {props.triage ? <RadarStrip {...props} /> : <IntakeStrip {...props} />}
    <RadarSide triage={props.triage} news={props.news} feeds={props.feeds} now={props.now} />
  </PageStack>;
}

function RadarStrip({ now, hero, pulse, seenSince, goal, onSelect, onEditGoal }: RadarBoardProps) {
  const { fresh, high, feeds } = pulse;
  const freshOnTop = hero.filter((item) => Date.parse(arrivedAt(item)) > Date.parse(seenSince)).length;
  const items: MetricProps[] = [
    {
      label: 'Novas',
      value: fresh.count,
      hint: freshOnTop > 0 ? `${sinceLabel(seenSince, now)} · ${freshOnTop} em Cobrir agora` : sinceLabel(seenSince, now),
      tooltip: fresh.newestId ? 'Abrir a mais recente' : undefined,
      onClick: fresh.newestId ? () => onSelect(fresh.newestId as string) : undefined,
    },
    {
      label: 'Prioridade alta',
      value: high.count,
      hint: high.waitingTooLong > 0
        ? `${high.waitingTooLong} esperando há mais de 2 h`
        : high.oldestAt ? `mais antiga ${waitLabel(high.oldestAt, now)}` : 'Nenhuma esperando',
      warn: high.waitingTooLong > 0,
      tooltip: high.oldestId ? 'Abrir a que espera há mais tempo' : undefined,
      onClick: high.oldestId ? () => onSelect(high.oldestId as string) : undefined,
    },
    {
      label: 'Pautas de hoje',
      value: `${goal.covered} de ${goal.perDay}`,
      meter: { value: Math.min(goal.covered, goal.perDay), max: goal.perDay, label: 'Pautas abertas hoje', tone: goal.covered >= goal.perDay ? 'green' : undefined },
      tooltip: 'Ajustar meta',
      onClick: onEditGoal,
    },
    {
      label: 'Fontes',
      value: `${feeds.active} de ${feeds.total}`,
      hint: feeds.failing > 0 ? `${feeds.failing} com falha` : 'Todas respondendo',
      warn: feeds.failing > 0,
      href: NEWS_SOURCES_HREF,
      linkAs: Link,
    },
  ];
  return <MetricStrip label="Sinais do radar" items={items} />;
}

/** The strip before the AI's triage (F2.1 on the server): what arrived, what spread, the sources. */
function IntakeStrip({ now, news, pulse, seenSince, onSelect }: RadarBoardProps) {
  const { fresh, feeds } = pulse;
  const intake = intakePulse(news, now);
  const items: MetricProps[] = [
    {
      label: 'Novas',
      value: fresh.count,
      hint: sinceLabel(seenSince, now),
      tooltip: fresh.newestId ? 'Abrir a mais recente' : undefined,
      onClick: fresh.newestId ? () => onSelect(fresh.newestId as string) : undefined,
    },
    { label: 'Em 24 h', value: intake.lastDay },
    {
      label: 'Em mais de um veículo',
      value: intake.spread.count,
      hint: intake.spread.topId ? `a maior em ${intake.spread.outlets} veículos` : undefined,
      tooltip: intake.spread.topId ? 'Abrir a que mais veículos publicaram' : undefined,
      onClick: intake.spread.topId ? () => onSelect(intake.spread.topId as string) : undefined,
    },
    {
      label: 'Fontes',
      value: `${feeds.active} de ${feeds.total}`,
      hint: feeds.failing > 0 ? `${feeds.failing} com falha` : feeds.total ? 'Todas respondendo' : undefined,
      warn: feeds.failing > 0,
      href: NEWS_SOURCES_HREF,
      linkAs: Link,
    },
  ];
  return <MetricStrip label="Sinais do radar" items={items} />;
}

function EmptyQueue({ query, onClearFilters, decided = false }: { query: string; onClearFilters: () => void; decided?: boolean }) {
  return <EmptyState size="panel" icon={Telescope} title={query ? 'Nenhuma notícia encontrada' : decided ? 'Nada decidido ainda' : 'Fila em dia'}
    actions={query ? <Button variant="secondary" size="sm" onClick={onClearFilters}>Limpar busca e filtros</Button> : undefined} />;
}

/** Rows occupy the same inbox space while the first snapshot loads. */
export function RadarSkeleton() {
  return <List label="Carregando notícias" framed={false}>
    {Array.from({ length: 8 }, (_, index) => <ListItemSkeleton key={index} />)}
  </List>;
}
