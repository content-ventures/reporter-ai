'use client';

import { Button, CardHeader, Grid, GridItem, IconButton, List, ListItem, Sparkline, Tooltip } from '@content-ventures/design-system/v3';
import { Info } from '@content-ventures/design-system/v3/icons';
import { waitLabel } from './radar-model';
import type { NewsTopic } from './topic-model';

/** A subject's size, reach and freshness (its latest story), in one line. */
export function topicFacts(topic: NewsTopic, now: number): string {
  const latest = topic.items.reduce((newest, item) => Math.max(newest, Math.min(Date.parse(item.publishedAt) || 0, now)), 0);
  return [
    `${topic.items.length} notícias`,
    `${topic.sources} ${topic.sources === 1 ? 'veículo' : 'veículos'}`,
    latest ? waitLabel(new Date(latest).toISOString(), now) : undefined,
  ].filter(Boolean).join(' · ');
}

/**
 * "Em alta": the terms the sources repeat in the last 24 hours, with the pace of each one over the
 * day. A subject filters the board in one click and lets go in another.
 */
export function TopicRadar({ topics, active, now, onSelect, onClear }: {
  topics: NewsTopic[]; active?: string; now: number; onSelect: (topic: NewsTopic) => void; onClear: () => void;
}) {
  if (!topics.length) return null;
  return <Grid columns="1:1" gap="sm">
    <GridItem span="full"><CardHeader size="md" titleAs="h2" title="Em alta" meta="Últimas 24 h" actions={active
      ? <Button variant="ghost" size="sm" onClick={onClear}>Ver todas</Button>
      : <Tooltip content="Termos que se repetem nas manchetes das últimas 24 horas. A linha mostra as publicações em intervalos de 4 horas; veículos conta os portais distintos.">
        <IconButton label="Como os assuntos são identificados" icon={Info} variant="ghost" size="sm" title="" />
      </Tooltip>} /></GridItem>
    <GridItem span="full"><List label="Assuntos em alta">
      {topics.map(topic => <ListItem key={topic.key} data-testid={`news-topic-${topic.key}`}
        title={topic.label} description={topicFacts(topic, now)}
        meta={<Sparkline points={topic.points} width={72} height={24} tone={active === topic.key ? 'blue' : 'gray'} />}
        selected={active === topic.key}
        onClick={() => (active === topic.key ? onClear() : onSelect(topic))} />)}
    </List></GridItem>
  </Grid>;
}
