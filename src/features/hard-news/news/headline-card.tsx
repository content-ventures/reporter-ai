'use client';

import { Badge, BrandMark, Card, CardHeader, CardLink, Grid, MediaFrame, MetaList, formatRelative } from '@content-ventures/design-system/v3';
import type { NewsItem } from '@/domain/hard-news';
import type { SourceRating } from '@/domain/news-source-rating';
import { newsLogoUrl } from '@/domain/news-branding';
import { SourceRatingBadge } from '../source-rating';
import { returnLabel } from './radar-model';

/** Two or three compact headlines across, with a fixed thumbnail column. */
export const HEADLINE_MIN_WIDTH = 280;

const DECISIONS = {
  selected: { label: 'Selecionada', tone: 'blue' },
  covered: { label: 'Coberta', tone: 'green' },
  later: { label: 'Adiada', tone: 'amber' },
  discarded: { label: 'Descartada', tone: 'gray' },
} as const;

/** A compact, consistent cover and headline; the received text opens on click. */
export function HeadlineCard({ item, rating, now, onSelect }: {
  item: NewsItem; rating?: SourceRating; now: number; onSelect: (id: string) => void;
}) {
  const decision = item.status === 'new' ? undefined : DECISIONS[item.status];
  return <Card as="article" padding="sm" interactive data-testid={`news-card-${item.id}`}>
    <Grid columns="1:2" collapseBelow={false} gap="sm" align="start">
      <MediaFrame src={item.imageUrl ?? newsLogoUrl(item.url)}
        alt={item.imageUrl ? `Imagem da notícia: ${item.title}` : `Marca de ${item.source}; notícia sem foto`}
        ratio="1/1" maxHeight={96} fit={item.imageUrl ? 'cover' : 'contain'} />
      <Grid columns="auto" min={HEADLINE_MIN_WIDTH} gap="sm">
      <MetaList size="sm" items={[
        <BrandMark key="logo" name={item.source} src={newsLogoUrl(item.url)} size="sm" decorative />,
        item.source,
      ]} />
      <CardHeader size="md" titleAs="h3" title={
        <CardLink onClick={() => onSelect(item.id)} aria-label={`Ler notícia: ${item.title}`}>{item.title}</CardLink>
      } />
      <MetaList size="sm" items={[
        formatRelative(new Date(Math.min(Date.parse(item.publishedAt), now)), new Date(now)),
        <SourceRatingBadge key="rating" rating={rating} compact />,
        decision ? <Badge key="decision" variant="text" tone={decision.tone} dot>{decision.label}</Badge> : null,
        item.status === 'later' && item.laterUntil ? returnLabel(item.laterUntil, now) : null,
        item.duplicates.length ? `${item.duplicates.length + 1} veículos` : null,
      ]} />
      </Grid>
    </Grid>
  </Card>;
}
