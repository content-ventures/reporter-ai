'use client';

import Link from 'next/link';
import {
  Badge,
  BrandMark,
  Button,
  EmptyState,
  Grid,
  List,
  ListGroup,
  ListItem,
  ListItemSkeleton,
  MetricStrip,
  MetaList,
  PageStack,
  Section,
  Spinner,
} from '@content-ventures/design-system/v3';
import type { MetricProps } from '@content-ventures/design-system/v3';
import { Telescope } from '@content-ventures/design-system/v3/icons';
import { newsLogoUrl } from '@/domain/news-branding';
import { sourceForNews } from '@/domain/news-source-match';
import type { SourceRating } from '@/domain/news-source-rating';
import { SourceRatingBadge } from '../source-rating';
import { priorityOf } from '@/domain/hard-news';
import type { NewsFeed, NewsItem } from '@/domain/hard-news';
import { NEWS_SOURCES_HREF } from '../routes';
import { arrivalLabel } from './news-ficha';
import { NewsCard } from './news-card';
import { PriorityBadge } from './priority-badge';
import { arrivedAt, intakePulse, returnLabel, sinceLabel, spread, waitLabel } from './radar-model';
import type { Pulse, WireGroup } from './radar-model';
import { RadarSide } from './radar-side';

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
  hero: NewsItem[];
  overflow: number;
  groups: WireGroup[];
  decided: NewsItem[];
  query: string;
  selectedId?: string;
  onSelect: (id: string) => void;
  onEditGoal: () => void;
  onClearFilters: () => void;
};

/**
 * The inbox keeps the news list uninterrupted; collection metrics live in the activity drawer.
 */
export function RadarBoard(props: RadarBoardProps) {
  const { triage, tab, now, feeds, hero, overflow, groups, decided, query, selectedId, onSelect, onClearFilters } = props;
  return (
    <PageStack>
      {triage && tab === 'open' ? (
        <Section title="Cobrir agora" meta={overflow > 0 ? `Prioridade alta · +${overflow} na fila` : 'Prioridade alta'}>
          {hero.length === 0 ? (
            <EmptyState size="inline" icon={Telescope} title={query ? 'Nada com prioridade alta na busca' : 'Nada para cobrir agora'} />
          ) : (
            <Grid as="ul" label="Cobrir agora" columns={hero.length >= 3 ? '1:1:1' : '1:1'} collapseBelow={640}>
              {hero.map((item) => <NewsCard key={item.id} item={item} rating={sourceForNews(item, feeds)?.rating} now={now} selected={item.id === selectedId} onSelect={onSelect} />)}
            </Grid>
          )}
        </Section>
      ) : null}
      {tab === 'open'
          ? <Wire triage={triage} feeds={feeds} groups={groups} query={query} now={now} selectedId={selectedId} onSelect={onSelect} onClearFilters={onClearFilters} />
          : <Decided feeds={feeds} items={decided} query={query} now={now} selectedId={selectedId} onSelect={onSelect} onClearFilters={onClearFilters} />}
    </PageStack>
  );
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

type ListProps = { onClearFilters: () => void; feeds: readonly NewsFeed[]; query: string; now: number; selectedId?: string; onSelect: (id: string) => void };

/** "Na fila": everything else waiting, by arrival, with the AI's priority as a dot + word. */
function Wire({ triage, feeds, groups, query, now, selectedId, onSelect, onClearFilters }: ListProps & { triage: boolean; groups: WireGroup[] }) {
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  if (!total) return <EmptyQueue query={query} onClearFilters={onClearFilters} />;
  return (
    <List label="Na fila" framed={false}>
      {groups.map((group) => (
        <ListGroup key={group.id} label={group.label} meta={group.items.length}>
          {group.items.map((item) => <WireRow key={item.id} triage={triage} item={item} rating={sourceForNews(item, feeds)?.rating} now={now} selected={item.id === selectedId} onSelect={onSelect} />)}
        </ListGroup>
      ))}
    </List>
  );
}

function EmptyQueue({ query, onClearFilters, decided = false }: { query: string; onClearFilters: () => void; decided?: boolean }) {
  return <EmptyState size="panel" icon={Telescope} title={query ? 'Nenhuma notícia encontrada' : decided ? 'Nada decidido ainda' : 'Fila em dia'}
    actions={query ? <Button variant="secondary" size="sm" onClick={onClearFilters}>Limpar busca e filtros</Button> : undefined} />;
}

function WireRow({ triage, item, rating, now, selected, onSelect }: { triage: boolean; item: NewsItem; rating?: SourceRating; now: number; selected: boolean; onSelect: (id: string) => void }) {
  const priority = priorityOf(item);
  const facts = [item.source, arrivalLabel(item, now)];
  if (item.classification) facts.push(item.classification.topic);
  const outlets = spread(item, now).outlets;
  return (
    <ListItem
      leading={<BrandMark name={item.source} src={newsLogoUrl(item.url)} size="sm" decorative />}
      title={item.title}
      titleLines={2}
      description={facts.join(' · ')}
      meta={<MetaList size="sm" items={[
        <SourceRatingBadge key="source" rating={rating} compact />,
        !triage ? (outlets > 1 ? <Badge key="spread" variant="text" tone="gray">{`${outlets} veículos`}</Badge> : null)
          : priority ? <PriorityBadge key="priority" priority={priority} size="sm" /> : <Spinner key="reading" size={14} tone="muted" label="A IA está lendo" />,
      ]} />}
      selected={selected}
      onClick={() => onSelect(item.id)}
      data-testid={`news-row-${item.id}`}
    />
  );
}

const DECIDED_BADGE = {
  selected: { label: 'Selecionada', tone: 'blue' },
  covered: { label: 'Coberta', tone: 'green' },
  later: { label: 'Adiada', tone: 'amber' },
  discarded: { label: 'Descartada', tone: 'gray' },
} as const;

/** "Decididas": what the desk covered, postponed or discarded, the latest decision first. */
function Decided({ items, feeds, query, now, selectedId, onSelect, onClearFilters }: ListProps & { items: NewsItem[] }) {
  if (!items.length) return <EmptyQueue query={query} onClearFilters={onClearFilters} decided />;
  return (
        <List label="Decididas" framed={false}>
          {items.map((item) => {
            const badge = item.status === 'new' ? undefined : DECIDED_BADGE[item.status];
            const detail = item.status === 'later' && item.laterUntil
              ? returnLabel(item.laterUntil, now)
              : item.status === 'discarded' ? item.discardReason : undefined;
            const who = item.decidedBy ? `${item.decidedBy} · ${item.decidedAt ? waitLabel(item.decidedAt, now) : ''}`.trim() : undefined;
            return (
              <ListItem
                key={item.id}
                leading={<BrandMark name={item.source} src={newsLogoUrl(item.url)} size="sm" decorative />}
                title={item.title}
                titleLines={2}
                description={[item.source, who, detail].filter(Boolean).join(' · ')}
                meta={<MetaList size="sm" items={[<SourceRatingBadge key="source" rating={sourceForNews(item, feeds)?.rating} compact />, badge ? <Badge key="decision" variant="text" tone={badge.tone} dot>{badge.label}</Badge> : null]} />}
                selected={item.id === selectedId}
                onClick={() => onSelect(item.id)}
                data-testid={`news-row-${item.id}`}
              />
            );
          })}
        </List>
  );
}

/** Rows occupy the same inbox space while the first snapshot loads. */
export function RadarSkeleton() {
  return <List label="Carregando notícias" framed={false}>
    {Array.from({ length: 8 }, (_, index) => <ListItemSkeleton key={index} />)}
  </List>;
}
