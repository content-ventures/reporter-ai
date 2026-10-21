'use client';

import { Button, Grid, GridItem, IconButton, PageStack, Section, Tooltip } from '@content-ventures/design-system/v3';
import { Info } from '@content-ventures/design-system/v3/icons';
import type { NewsFeed, NewsItem } from '@/domain/hard-news';
import { sourceForNews } from '@/domain/news-source-match';
import { editionSignal } from './edition-model';
import { HEADLINE_MIN_WIDTH, HeadlineCard } from './headline-card';
import { TopicRadar } from './topic-radar';
import type { NewsTopic } from './topic-model';

/** A portal cover: one lead, three secondary stories, then the chronological wire. */
export function NewsEdition({ items, feeds, now, triage, topics, onTopic, onSelect, limit, onLoadMore }: {
  items: NewsItem[]; feeds: readonly NewsFeed[]; now: number; triage: boolean;
  topics: NewsTopic[]; onTopic: (topic: NewsTopic) => void; onSelect: (id: string) => void;
  limit: number; onLoadMore: () => void;
}) {
  const visible = items.slice(0, limit);
  const [lead, ...secondary] = visible.slice(0, 4);
  const latest = visible.slice(4, 8);
  const card = (item: NewsItem, variant: 'feature' | 'tile' | 'compact' = 'compact') => <HeadlineCard
    key={item.id} item={item} now={now} rating={sourceForNews(item, feeds)?.rating} variant={variant}
    signal={variant === 'feature' ? editionSignal(item, now, triage) : undefined} onSelect={onSelect} />;
  return <PageStack data-testid="news-edition">
    <Grid columns="2:1" collapseBelow={760} align="start">
      <Section title="Em destaque" action={<Tooltip content={triage
        ? 'Notícias das últimas 24 horas primeiro; depois, prioridade editorial, nota, presença em outros veículos e data. A força da fonte e a foto não definem a ordem.'
        : 'Sugestão de leitura: notícias das últimas 24 horas, presença em outros veículos e data de publicação. A prioridade editorial ainda não foi avaliada. A força da fonte e a foto não definem a ordem.'}>
        <IconButton icon={Info} variant="ghost" size="sm" label="Como os destaques são escolhidos" />
      </Tooltip>}>
        <Grid columns="1:1" gap="md">
          <GridItem span="full">{lead ? card(lead, 'feature') : null}</GridItem>
          {secondary.length ? <GridItem span="full"><Grid columns="1:1:1" collapseBelow={480} gap="sm">
            {secondary.map(item => card(item, 'tile'))}
          </Grid></GridItem> : null}
        </Grid>
      </Section>
      {latest.length ? <GridItem><Section title="Últimas notícias">
        <Grid columns="1:1" gap="sm">{latest.map(item => <GridItem key={item.id} span="full">{card(item)}</GridItem>)}</Grid>
      </Section></GridItem> : null}
    </Grid>
    {visible.length > 8 ? <Grid columns="2:1" collapseBelow={760} align="start">
      <Section title="Mais notícias" meta={`${items.length} na fila`}>
        <Grid as="section" label="Manchetes" columns="auto" min={HEADLINE_MIN_WIDTH} gap="sm">
          {visible.slice(8).map(item => card(item))}
        </Grid>
      </Section>
      <TopicRadar topics={topics} onSelect={onTopic} onClear={() => undefined} layout="list" />
    </Grid> : <TopicRadar topics={topics} onSelect={onTopic} onClear={() => undefined} />}
    {items.length > limit ? <Button variant="secondary" onClick={onLoadMore}>Carregar mais manchetes</Button> : null}
  </PageStack>;
}
