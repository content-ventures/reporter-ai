'use client';

import {
  Badge,
  BrandMark,
  Card,
  CardHeader,
  CardLink,
  EditableTitle,
  Grid,
  GridItem,
  IconButton,
  List,
  MediaFrame,
  MetaList,
  Prose,
  Tooltip,
} from '@content-ventures/design-system/v3';
import { Info } from '@content-ventures/design-system/v3/icons';
import type { NewsFeed, NewsItem } from '@/domain/hard-news';
import { newsLogoUrl } from '@/domain/news-branding';
import { sourceForNews } from '@/domain/news-source-match';
import type { SourceRating } from '@/domain/news-source-rating';
import { SourceRatingBadge } from '../source-rating';
import { editionSignal } from './edition-model';
import { leadLine } from './news-model';
import { photoOf } from './news-photo';
import { NewsRow } from './news-row';
import { whenLabel } from './radar-model';

const HOW_TRIAGE = 'Notícias recentes primeiro; o score considera tema e público do mapa, avaliação do veículo, novidade e atualidade. O editor decide o que vira pauta.';
const HOW_LIVE = 'Sugestão de leitura: notícias das últimas 24 horas, presença em outros veículos e data de publicação. A prioridade editorial ainda não foi avaliada. A força da fonte e a foto não definem a ordem.';

/** "Em destaque": the lead story, then the next highlights as rows, before the wire. */
export function NewsCover({ items, feeds, now, triage, compact, fresh, onSelect }: {
  items: NewsItem[]; feeds: readonly NewsFeed[]; now: number; triage: boolean; compact: boolean;
  /** Arrived since the last look. */
  fresh: (item: NewsItem) => boolean;
  onSelect: (id: string) => void;
}) {
  const [lead, ...others] = items;
  if (!lead) return null;
  const rating = (item: NewsItem) => sourceForNews(item, feeds)?.rating;
  return <Grid columns="1:1" gap="sm" data-testid="news-edition">
    <GridItem span="full"><CardHeader size="md" titleAs="h2" title="Em destaque" actions={<Tooltip content={triage ? HOW_TRIAGE : HOW_LIVE}>
      <IconButton icon={Info} variant="ghost" size="sm" label="Como os destaques são escolhidos" title="" />
    </Tooltip>} /></GridItem>
    <GridItem span="full"><LeadStory item={lead} rating={rating(lead)} now={now} signal={editionSignal(lead, triage)} fresh={fresh(lead)} onSelect={onSelect} /></GridItem>
    {others.length ? <GridItem span="full"><List label="Outros destaques">
      {others.map(item => <NewsRow key={item.id} item={item} rating={rating(item)} now={now} compact={compact} fresh={fresh(item)} onSelect={onSelect} />)}
    </List></GridItem> : null}
  </Grid>;
}

/**
 * The lead: its photo beside the headline when it has one; without a photo, the received lead line
 * under the headline (never a site icon stretched into a photo frame).
 */
function LeadStory({ item, rating, now, signal, fresh, onSelect }: {
  item: NewsItem; rating?: SourceRating; now: number; signal?: string; fresh: boolean; onSelect: (id: string) => void;
}) {
  const photo = photoOf(item);
  const line = photo ? undefined : leadLine(item.excerpt, item.title);
  const story = <Grid columns="1:1" gap="sm">
    <GridItem span="full"><MetaList size="sm" items={[
      fresh ? <Badge key="fresh" variant="text" tone="blue" dot>Nova</Badge> : null,
      <BrandMark key="logo" name={item.source} src={newsLogoUrl(item.url)} size="sm" decorative />,
      item.source,
      signal ? <Badge key="signal" tone={signal === 'Prioridade alta' ? 'orange' : 'blue'} size="sm">{signal}</Badge> : null,
    ]} /></GridItem>
    <GridItem span="full"><EditableTitle value={item.title} as="h3" size="page" label="Manchete principal" readOnly onCommit={() => undefined} /></GridItem>
    {line ? <GridItem span="full"><Prose variant="compact" measure="wide" align="start">{line}</Prose></GridItem> : null}
    <GridItem span="full"><MetaList size="sm" items={[
      whenLabel(item.publishedAt, now),
      <SourceRatingBadge key="rating" rating={rating} compact />,
      <CardLink key="read" onClick={() => onSelect(item.id)} aria-label={`Ler notícia: ${item.title}`}>Ler notícia</CardLink>,
    ]} /></GridItem>
  </Grid>;
  return <Card as="article" padding="md" interactive data-testid={`news-card-${item.id}`} data-news-layout="lead">
    {photo ? <Grid columns="1:1" collapseBelow={480} align="start">
      <MediaFrame src={photo} ratio="16/9" alt={`Imagem da notícia: ${item.title}`} />
      {story}
    </Grid> : story}
  </Card>;
}
