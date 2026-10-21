'use client';

import { Badge, Button, Card, CardHeader, CardLink, Carousel, Grid, GridItem, IconButton, MetaList, Sparkline, Tooltip } from '@content-ventures/design-system/v3';
import { Info } from '@content-ventures/design-system/v3/icons';
import type { NewsTopic } from './topic-model';

export function TopicRadar({ topics, active, onSelect, onClear }: {
  topics: NewsTopic[]; active?: string; onSelect: (topic: NewsTopic) => void; onClear: () => void;
}) {
  if (!topics.length) return null;
  return <Grid columns="1:1" gap="sm">
    <GridItem span="full"><CardHeader size="md" titleAs="h2" title="Em pauta" meta="Últimas 24 h" actions={active
    ? <Button variant="ghost" size="sm" onClick={onClear}>Ver todas</Button>
    : <Tooltip content="Termos recorrentes nas manchetes coletadas. A linha mostra publicações em intervalos de 4 horas; o número de fontes conta portais distintos."><IconButton label="Como os assuntos são identificados" icon={Info} variant="ghost" size="sm" /></Tooltip>} /></GridItem>
    <GridItem span="full"><Carousel label="Assuntos recorrentes nas fontes" perView={3}>
      {topics.map((topic, index) => <Card key={topic.key} padding="sm" interactive selected={active === topic.key} data-testid={`news-topic-${topic.key}`}>
          <Grid columns="auto" min={280} gap="sm">
            <CardHeader size="md" titleAs="h3" leading={<Badge tone={active === topic.key ? 'blue' : 'gray'} size="sm">{index + 1}</Badge>}
              title={<CardLink aria-pressed={active === topic.key} aria-label={`Explorar assunto: ${topic.label}`} onClick={() => onSelect(topic)}>{topic.label}</CardLink>} />
            <Grid columns="2:1" collapseBelow={false} gap="sm">
              <MetaList size="xs" items={[`${topic.items.length} notícias`, `${topic.sources} ${topic.sources === 1 ? 'fonte' : 'fontes'}`]} />
              <Sparkline points={topic.points} height={20} fluid tone="gray" />
            </Grid>
          </Grid>
        </Card>)}
    </Carousel></GridItem>
  </Grid>;
}
