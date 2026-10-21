'use client';

import { Badge, BrandMark, Card, CardLink, EditableTitle, MediaFrame, MetaList, PageStack, Prose, formatRelative } from '@content-ventures/design-system/v3';
import type { NewsItem } from '@/domain/hard-news';
import type { SourceRating } from '@/domain/news-source-rating';
import { SOURCE_RELEVANCE_LABELS } from '@/domain/news-source-rating';
import { newsLogoUrl } from '@/domain/news-branding';
import { SourceRatingBadge } from '../source-rating';
import { returnLabel } from './radar-model';

const DECISIONS = {
  selected: { label: 'Selecionada', tone: 'blue' },
  covered: { label: 'Coberta', tone: 'green' },
  later: { label: 'Adiada', tone: 'amber' },
  discarded: { label: 'Descartada', tone: 'gray' },
} as const;

/** A headline previews the received lead; reading and editorial decisions start on click. */
export function HeadlineCard({ item, rating, now, featured = false, onSelect }: {
  item: NewsItem; rating?: SourceRating; now: number; featured?: boolean; onSelect: (id: string) => void;
}) {
  const limit = featured ? 320 : 150;
  const excerpt = item.excerpt.length > limit ? `${item.excerpt.slice(0, limit).replace(/\s+\S*$/, '')}…` : item.excerpt;
  const decision = item.status === 'new' ? undefined : DECISIONS[item.status];
  return <Card as="article" padding={featured ? 'lg' : 'md'} interactive data-testid={`news-card-${item.id}`}>
    <PageStack>
      {item.imageUrl ? <MediaFrame src={item.imageUrl} alt={`Imagem da notícia: ${item.title}`} ratio="16/9" fit="cover" /> : null}
      <MetaList size="sm" items={[
        <BrandMark key="logo" name={item.source} src={newsLogoUrl(item.url)} size={featured ? 'md' : 'sm'} decorative />,
        item.source,
        formatRelative(new Date(Math.min(Date.parse(item.publishedAt), now)), new Date(now)),
      ]} />
      <EditableTitle value={item.title} label="Manchete" readOnly as="h3" size={featured ? 'document' : 'card'} onCommit={() => undefined} />
      {excerpt ? <Prose variant="compact" measure="wide">{excerpt}</Prose> : null}
      <MetaList size="sm" items={[
        <SourceRatingBadge key="rating" rating={rating} />,
        featured && rating ? `Relevância ${SOURCE_RELEVANCE_LABELS[rating.relevance].toLowerCase()}` : null,
        decision ? <Badge key="decision" variant="text" tone={decision.tone} dot>{decision.label}</Badge> : null,
        item.status === 'later' && item.laterUntil ? returnLabel(item.laterUntil, now) : null,
        item.translation?.status === 'translated' ? 'Traduzida · pt-BR' : null,
        item.duplicates.length ? `${item.duplicates.length + 1} veículos` : null,
      ]} />
      <CardLink onClick={() => onSelect(item.id)} aria-label={`Ler notícia: ${item.title}`}>Ler notícia</CardLink>
    </PageStack>
  </Card>;
}
