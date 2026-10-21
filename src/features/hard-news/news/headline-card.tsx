'use client';

import { Badge, BrandMark, Card, CardHeader, CardLink, EditableTitle, Grid, GridItem, MediaFrame, MetaList, formatRelative } from '@content-ventures/design-system/v3';
import type { NewsItem } from '@/domain/hard-news';
import type { SourceRating } from '@/domain/news-source-rating';
import { newsLogoUrl } from '@/domain/news-branding';
import { SourceRatingBadge } from '../source-rating';
import { returnLabel } from './radar-model';
import { editionOutlets } from './edition-model';

/** Two or three compact headlines across, with a fixed thumbnail column. */
export const HEADLINE_MIN_WIDTH = 280;

const DECISIONS = {
  selected: { label: 'Selecionada', tone: 'blue' },
  covered: { label: 'Coberta', tone: 'green' },
  later: { label: 'Adiada', tone: 'amber' },
  discarded: { label: 'Descartada', tone: 'gray' },
} as const;

/** A compact, consistent cover and headline; the received text opens on click. */
export function HeadlineCard({ item, rating, now, onSelect, variant = 'compact', signal }: {
  item: NewsItem; rating?: SourceRating; now: number; onSelect: (id: string) => void;
  variant?: 'compact' | 'feature' | 'tile'; signal?: string;
}) {
  const decision = item.status === 'new' ? undefined : DECISIONS[item.status];
  const feature = variant === 'feature';
  const compact = variant === 'compact';
  const outlets = editionOutlets(item);
  const content = <Grid columns="1:1" gap="sm">
      <GridItem span="full"><MetaList size="sm" items={[
        <BrandMark key="logo" name={item.source} src={newsLogoUrl(item.url)} size="sm" decorative />,
        item.source,
        signal ? <Badge key="signal" tone={signal === 'Prioridade alta' ? 'orange' : 'blue'} size="sm">{signal}</Badge> : null,
      ]} /></GridItem>
      <GridItem span="full">{feature ? <EditableTitle value={item.title} as="h3" size="page" label="Manchete principal" readOnly onCommit={() => undefined} /> : <CardHeader size="md" titleAs="h3" title={
        <CardLink onClick={() => onSelect(item.id)} aria-label={`Ler notícia: ${item.title}`}>{item.title}</CardLink>
      } />}</GridItem>
      <GridItem span="full"><MetaList size="sm" items={[
        formatRelative(new Date(Math.min(Date.parse(item.publishedAt), now)), new Date(now)),
        <SourceRatingBadge key="rating" rating={rating} compact />,
        decision ? <Badge key="decision" variant="text" tone={decision.tone} dot>{decision.label}</Badge> : null,
        item.status === 'later' && item.laterUntil ? returnLabel(item.laterUntil, now) : null,
        outlets > 1 ? `${outlets} veículos` : null,
        feature ? <CardLink key="read" onClick={() => onSelect(item.id)} aria-label={`Ler notícia: ${item.title}`}>Ler notícia</CardLink> : null,
      ]} /></GridItem>
    </Grid>;
  const alt = item.imageUrl ? `Imagem da notícia: ${item.title}` : `Marca de ${item.source}; notícia sem foto`;
  return <Card as="article" padding="sm" interactive data-testid={`news-card-${item.id}`} data-news-layout={variant}>
    {compact ? <Grid columns="1:2" collapseBelow={false} gap="sm" align="start">
      <MediaFrame src={item.imageUrl ?? newsLogoUrl(item.url)} alt={alt} ratio="1/1" maxHeight={96} fit={item.imageUrl ? 'cover' : 'contain'} />
      {content}
    </Grid> : <Grid columns="1:1" gap="sm">
      <GridItem span="full"><MediaFrame src={item.imageUrl ?? newsLogoUrl(item.url)} ratio={feature ? '16/4' : '16/9'} alt={alt}
        maxHeight={feature ? undefined : 104} fit={item.imageUrl ? 'cover' : 'contain'} /></GridItem>
      <GridItem span="full">{content}</GridItem>
    </Grid>}
  </Card>;
}
