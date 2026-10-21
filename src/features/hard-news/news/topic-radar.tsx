'use client';

import { Badge, Button, Card, CardHeader, CardLink, Carousel, Grid, IconButton, MediaFrame, MetaList, Section, Sparkline, Tooltip } from '@content-ventures/design-system/v3';
import { Info } from '@content-ventures/design-system/v3/icons';
import { newsLogoUrl } from '@/domain/news-branding';
import type { NewsTopic } from './topic-model';

export function TopicRadar({ topics, active, onSelect, onClear }: {
  topics: NewsTopic[]; active?: string; onSelect: (topic: NewsTopic) => void; onClear: () => void;
}) {
  if (!topics.length) return null;
  return <Section variant="panel" title="Em pauta" meta="Últimas 24 h" action={active
    ? <Button variant="ghost" size="sm" onClick={onClear}>Ver todas</Button>
    : <Tooltip content="Termos recorrentes nas manchetes coletadas. A linha mostra publicações em intervalos de 4 horas; o número de fontes conta portais distintos."><IconButton label="Como os assuntos são identificados" icon={Info} variant="ghost" size="sm" /></Tooltip>}>
    <Carousel label="Assuntos recorrentes nas fontes" perView={3}>
      {topics.map((topic, index) => {
        const cover = topic.items.find(item => item.imageUrl) ?? topic.items[0];
        return <Card key={topic.key} padding="sm" interactive data-testid={`news-topic-${topic.key}`}>
          <Grid columns="1:2" collapseBelow={false} gap="sm" align="start">
            <MediaFrame src={cover.imageUrl ?? newsLogoUrl(cover.url)} ratio="1/1" maxHeight={80}
              fit={cover.imageUrl ? 'cover' : 'contain'} alt={cover.imageUrl ? `Imagem de: ${cover.title}` : `Marca de ${cover.source}`} />
            <Grid columns="auto" min={280} gap="sm">
              <CardHeader size="md" titleAs="h3" leading={<Badge tone={active === topic.key ? 'blue' : 'gray'} size="sm">{index + 1}</Badge>}
                title={<CardLink aria-pressed={active === topic.key} aria-label={`Explorar assunto: ${topic.label}`} onClick={() => onSelect(topic)}>{topic.label}</CardLink>} />
              <MetaList size="sm" items={[`${topic.items.length} notícias`, `${topic.sources} ${topic.sources === 1 ? 'fonte' : 'fontes'}`]} />
              <Sparkline points={topic.points} height={24} fluid tone="gray" />
            </Grid>
          </Grid>
        </Card>;
      })}
    </Carousel>
  </Section>;
}
