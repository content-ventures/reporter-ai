'use client';
import {useWorkspaceHref} from '@/ui/workspace-navigation';

import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  Button,
  CardHeader,
  EmptyState,
  Grid,
  GridItem,
  List,
  ListItemSkeleton,
  MeterList,
  MetricStrip,
  PageStack,
} from '@content-ventures/design-system/v3';
import type { MetricProps } from '@content-ventures/design-system/v3';
import { CheckCheck, SearchX, Telescope } from '@content-ventures/design-system/v3/icons';
import { sourceForNews } from '@/domain/news-source-match';
import type { NewsFeed, NewsItem } from '@/domain/hard-news';
import { NEWS_SOURCES_HREF } from '../routes';
import { NewsCover } from './news-cover';
import { NewsRow } from './news-row';
import { arrivedAt, hourlyPace, intakePulse, outletShare, pageOf, sinceLabel, waitLabel } from './radar-model';
import type { BoardGroup, Pulse } from './radar-model';
import { RadarSide } from './radar-side';
import { TopicRadar } from './topic-radar';
import type { NewsTopic } from './topic-model';

export type RadarBoardProps = {
  /** The AI's triage exists (the simulation): "Cobrir agora", priorities and the day's goal. */
  triage: boolean;
  tab: 'open' | 'decided';
  now: number;
  news: readonly NewsItem[];
  feeds: readonly NewsFeed[];
  pulse: Pulse;
  seenSince: string;
  goal: { covered: number; perDay: number };
  /** The simulation's best high-priority story, counted on the activity strip. */
  hero: NewsItem[];
  /** The cover's lead and highlights (the open queue with no search, filter or topic). */
  cover: NewsItem[];
  /** The rest of the board in reading order: arrival groups, or the decisions. */
  groups: BoardGroup[];
  /** A search, a filter or a topic narrows the board. */
  filtered: boolean;
  topics: NewsTopic[];
  topic?: Pick<NewsTopic, 'key' | 'label'>;
  onTopic: (topic: NewsTopic) => void;
  onClearTopic: () => void;
  onSelect: (id: string) => void;
  visibleCount: number;
  onLoadMore: () => void;
  onEditGoal: () => void;
  onClearFilters: () => void;
  /** The decisions a row offers (none for a person who cannot decide). */
  decision: (item: NewsItem) => ReactNode;
  /** Phone: rows carry their time in the facts line. */
  compact: boolean;
};

/**
 * The radar, built to answer at a glance what matters now: the pulse of the sources, the stories
 * leading the day beside the subjects in the news, then the live wire with when, where and how far
 * each story spread. A subject keeps the subjects beside its stories; a search shows only results.
 */
export function RadarBoard(props: RadarBoardProps) {
  const { tab, now, feeds, cover, groups, topic, visibleCount, onSelect, decision, compact } = props;
  const total = cover.length + groups.reduce((sum, group) => sum + group.items.length, 0);
  const page = pageOf(groups, visibleCount - cover.length);
  const sizes = new Map(groups.map(group => [group.id, group.items.length]));
  const subjects = tab === 'open' && props.topics.length
    ? <TopicRadar topics={props.topics.slice(0, 5)} active={topic?.key} now={now} onSelect={props.onTopic} onClear={props.onClearTopic} />
    : null;
  const wire = <>
    {total === 0 ? <EmptyQueue filtered={props.filtered} decided={tab === 'decided'} onClearFilters={props.onClearFilters} /> : null}
    {page.map(group => <Grid key={group.id} columns="1:1" gap="sm">
      <GridItem span="full"><CardHeader size="md" titleAs="h2" title={group.label} meta={String(sizes.get(group.id) ?? group.items.length)} /></GridItem>
      <GridItem span="full"><List label={group.label}>
        {group.items.map(item => <NewsRow key={item.id} item={item} rating={sourceForNews(item, feeds)?.rating} now={now}
          compact={compact} onSelect={onSelect} actions={decision(item)} />)}
      </List></GridItem>
    </Grid>)}
    {total > visibleCount ? <Button variant="secondary" onClick={props.onLoadMore}>Carregar mais manchetes</Button> : null}
  </>;
  if (cover.length) {
    const seen = Date.parse(props.seenSince);
    const lead = <NewsCover items={cover} feeds={feeds} now={now} triage={props.triage} compact={compact}
      fresh={item => Date.parse(arrivedAt(item)) > seen} onSelect={onSelect} />;
    // Beside the cover the column keeps about its height: five subjects, the three busiest outlets.
    const outlets = outletShare(props.news, now, 3);
    return <PageStack data-testid="news-headlines">
      {props.triage ? <RadarStrip {...props} /> : <IntakeStrip {...props} />}
      <Grid columns="2:1" align="start">
        {lead}
        <PageStack>
          {subjects}
          {outlets.length ? <Outlets outlets={outlets} /> : null}
        </PageStack>
      </Grid>
      {wire}
    </PageStack>;
  }
  if (topic && subjects) return <PageStack data-testid="news-headlines">
    <Grid columns="2:1" align="start"><PageStack>{wire}</PageStack>{subjects}</Grid>
  </PageStack>;
  return <PageStack data-testid="news-headlines">{wire}</PageStack>;
}

/** Where the day's news comes from: the outlets that published the most in the last 24 hours. */
function Outlets({ outlets }: { outlets: ReturnType<typeof outletShare> }) {
  return <Grid columns="1:1" gap="sm">
    <GridItem span="full"><CardHeader size="md" titleAs="h2" title="Veículos" meta="Últimas 24 h" /></GridItem>
    <GridItem span="full"><MeterList label="Notícias por veículo nas últimas 24 horas" items={outlets} /></GridItem>
  </Grid>;
}

/** The detail behind the pulse: arrivals hour by hour and the health of every source. */
export function RadarActivity(props: RadarBoardProps) {
  return <RadarSide triage={props.triage} news={props.news} feeds={props.feeds} now={props.now} />;
}

function RadarStrip({ now, hero, pulse, seenSince, goal, onSelect, onEditGoal }: RadarBoardProps) {
  const workspaceHref=useWorkspaceHref();
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
      href: workspaceHref(NEWS_SOURCES_HREF),
      linkAs: Link,
    },
  ];
  return <MetricStrip label="Pulso do radar" items={items} />;
}

/**
 * The pulse before the AI's triage (F2.1 on the server): what is new since the last look, the pace of
 * the last hour against the hour before, what more than one outlet ran and whether the sources answer.
 */
function IntakeStrip({ now, news, pulse, seenSince, onSelect }: RadarBoardProps) {
  const workspaceHref=useWorkspaceHref();
  const { fresh, feeds } = pulse;
  const intake = intakePulse(news, now);
  const pace = hourlyPace(news, now);
  const [before, last] = [pace.at(-2) ?? 0, pace.at(-1) ?? 0];
  const change = last - before;
  const items: MetricProps[] = [
    {
      label: 'Novas',
      value: fresh.count,
      hint: sinceLabel(seenSince, now),
      tooltip: fresh.newestId ? 'Abrir a mais recente' : undefined,
      onClick: fresh.newestId ? () => onSelect(fresh.newestId as string) : undefined,
    },
    {
      label: 'Na última hora',
      value: last,
      delta: { value: change > 0 ? `+${change}` : change < 0 ? `−${-change}` : '0', trend: change > 0 ? 'up' : change < 0 ? 'down' : 'flat', tone: 'flat',
        label: `${last} na última hora, ${before} na hora anterior` },
      sparkline: { points: pace, label: 'Chegadas por hora nas últimas 12 horas' },
      hint: `${before} na hora anterior`,
    },
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
      href: workspaceHref(NEWS_SOURCES_HREF),
      linkAs: Link,
    },
  ];
  return <MetricStrip label="Pulso do radar" items={items} />;
}

function EmptyQueue({ filtered, decided, onClearFilters }: { filtered: boolean; decided: boolean; onClearFilters: () => void }) {
  if (filtered) return <EmptyState size="panel" icon={SearchX} title="Nenhuma notícia encontrada"
    actions={<Button variant="secondary" size="sm" onClick={onClearFilters}>Limpar busca e filtros</Button>} />;
  return <EmptyState size="panel" icon={decided ? Telescope : CheckCheck} title={decided ? 'Nada decidido ainda' : 'Fila em dia'} />;
}

/** Rows occupy the same inbox space while the first snapshot loads. */
export function RadarSkeleton() {
  return <List label="Carregando notícias">
    {Array.from({ length: 8 }, (_, index) => <ListItemSkeleton key={index} />)}
  </List>;
}
