'use client';

import Link from 'next/link';
import {
  Badge,
  BrandMark,
  Button,
  Card,
  EmptyState,
  Grid,
  List,
  ListGroup,
  ListItem,
  ListItemSkeleton,
  MetricStrip,
  PageStack,
  Panel,
  Section,
  Spinner,
} from '@content-ventures/design-system/v3';
import type { MetricProps } from '@content-ventures/design-system/v3';
import { Telescope } from '@content-ventures/design-system/v3/icons';
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
  onMarkSeen: () => void;
};

/**
 * The radar's board (F2.1, F2.2, F2.4), top to bottom: the strip (what is new, what is waiting,
 * the day's goal, the sources), "Cobrir agora" (the high-priority stories as cards), then the
 * wire by arrival beside the instruments (arrivals per hour, the sources' health).
 */
export function RadarBoard(props: RadarBoardProps) {
  const { triage, tab, now, news, feeds, hero, overflow, groups, decided, query, selectedId, onSelect, onMarkSeen } = props;
  return (
    <PageStack>
      {triage ? <RadarStrip {...props} /> : <IntakeStrip {...props} />}
      {triage && tab === 'open' ? (
        <Section title="Cobrir agora" meta={overflow > 0 ? `Prioridade alta · +${overflow} na fila` : 'Prioridade alta'}>
          {hero.length === 0 ? (
            <EmptyState size="inline" icon={Telescope} title={query ? 'Nada com prioridade alta na busca' : 'Nada para cobrir agora'} />
          ) : (
            <Grid as="ul" label="Cobrir agora" columns={hero.length >= 3 ? '1:1:1' : '1:1'} collapseBelow={640}>
              {hero.map((item) => <NewsCard key={item.id} item={item} now={now} selected={item.id === selectedId} onSelect={onSelect} />)}
            </Grid>
          )}
        </Section>
      ) : null}
      <Grid columns="3:2" collapseBelow={640} align="start">
        {tab === 'open'
          ? <Wire triage={triage} groups={groups} query={query} now={now} selectedId={selectedId} onSelect={onSelect} onMarkSeen={onMarkSeen} />
          : <Decided items={decided} query={query} now={now} selectedId={selectedId} onSelect={onSelect} />}
        <RadarSide triage={triage} news={news} feeds={feeds} now={now} />
      </Grid>
    </PageStack>
  );
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

type ListProps = { query: string; now: number; selectedId?: string; onSelect: (id: string) => void };

/** "Na fila": everything else waiting, by arrival, with the AI's priority as a dot + word. */
function Wire({ triage, groups, query, now, selectedId, onSelect, onMarkSeen }: ListProps & { triage: boolean; groups: WireGroup[]; onMarkSeen: () => void }) {
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  const fresh = groups.some((group) => group.id === 'new');
  return (
    <Panel label="Na fila">
      <Section title="Na fila" meta={total} action={fresh ? <Button variant="ghost" size="sm" onClick={onMarkSeen}>Marcar como vistas</Button> : undefined}>
        {total === 0 ? (
          <List label="Na fila" framed={false} bleed empty={query ? 'Nenhuma notícia encontrada' : 'Fila em dia'} />
        ) : (
          <List label="Na fila" framed={false} bleed>
            {groups.map((group) => (
              <ListGroup key={group.id} label={group.label} meta={group.items.length}>
                {group.items.map((item) => <WireRow key={item.id} triage={triage} item={item} now={now} selected={item.id === selectedId} onSelect={onSelect} />)}
              </ListGroup>
            ))}
          </List>
        )}
      </Section>
    </Panel>
  );
}

function WireRow({ triage, item, now, selected, onSelect }: { triage: boolean; item: NewsItem; now: number; selected: boolean; onSelect: (id: string) => void }) {
  const priority = priorityOf(item);
  const facts = [item.source, arrivalLabel(item, now)];
  if (item.classification) facts.push(item.classification.topic);
  const outlets = spread(item, now).outlets;
  return (
    <ListItem
      leading={<BrandMark name={item.source} size="sm" decorative />}
      title={item.title}
      titleLines={2}
      description={facts.join(' · ')}
      meta={!triage
        ? (outlets > 1 ? <Badge variant="text" tone="gray">{`${outlets} veículos`}</Badge> : undefined)
        : priority ? <PriorityBadge priority={priority} size="sm" /> : <Spinner size={14} tone="muted" label="A IA está lendo" />}
      selected={selected}
      onClick={() => onSelect(item.id)}
      data-testid={`news-row-${item.id}`}
    />
  );
}

const DECIDED_BADGE = {
  covered: { label: 'Coberta', tone: 'green' },
  later: { label: 'Adiada', tone: 'amber' },
  discarded: { label: 'Descartada', tone: 'gray' },
} as const;

/** "Decididas": what the desk covered, postponed or discarded, the latest decision first. */
function Decided({ items, query, now, selectedId, onSelect }: ListProps & { items: NewsItem[] }) {
  return (
    <Panel label="Decididas">
      <Section title="Decididas" meta={items.length}>
        <List label="Decididas" framed={false} bleed empty={query ? 'Nenhuma notícia encontrada' : 'Nada decidido ainda'}>
          {items.map((item) => {
            const badge = item.status === 'new' ? undefined : DECIDED_BADGE[item.status];
            const detail = item.status === 'later' && item.laterUntil
              ? returnLabel(item.laterUntil, now)
              : item.status === 'discarded' ? item.discardReason : undefined;
            const who = item.decidedBy ? `${item.decidedBy} · ${item.decidedAt ? waitLabel(item.decidedAt, now) : ''}`.trim() : undefined;
            return (
              <ListItem
                key={item.id}
                leading={<BrandMark name={item.source} size="sm" decorative />}
                title={item.title}
                titleLines={2}
                description={[who, detail].filter(Boolean).join(' · ')}
                meta={badge ? <Badge variant="text" tone={badge.tone} dot>{badge.label}</Badge> : undefined}
                selected={item.id === selectedId}
                onClick={() => onSelect(item.id)}
                data-testid={`news-row-${item.id}`}
              />
            );
          })}
        </List>
      </Section>
    </Panel>
  );
}

/** The board before this browser's desk loads: the same blocks, still. */
export function RadarSkeleton({ triage = true }: { triage?: boolean }) {
  const signals = triage ? ['Novas', 'Prioridade alta', 'Pautas de hoje', 'Fontes'] : ['Novas', 'Em 24 h', 'Em mais de um veículo', 'Fontes'];
  return (
    <PageStack>
      <MetricStrip label="Sinais do radar" items={signals.map((label) => ({ label, loading: true }))} />
      {triage ? (
        <Section title="Cobrir agora">
          <Grid columns="1:1:1" collapseBelow={640}>
            <Card padding="md" loading>{null}</Card>
            <Card padding="md" loading>{null}</Card>
            <Card padding="md" loading>{null}</Card>
          </Grid>
        </Section>
      ) : null}
      <Grid columns="3:2" collapseBelow={640} align="start">
        <Panel label="Na fila">
          <Section title="Na fila">
            <List label="Na fila" framed={false} bleed>
              <ListItemSkeleton />
              <ListItemSkeleton />
              <ListItemSkeleton />
            </List>
          </Section>
        </Panel>
        <Panel label="Fontes">
          <Section title="Fontes">
            <List label="Fontes" framed={false} bleed>
              <ListItemSkeleton />
              <ListItemSkeleton />
            </List>
          </Section>
        </Panel>
      </Grid>
    </PageStack>
  );
}
