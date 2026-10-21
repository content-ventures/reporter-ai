'use client';

import { newsLogoUrl } from '@/domain/news-branding';

import {
  BrandMark,
  Card,
  CardHeader,
  CardLink,
  Delta,
  MetaList,
  PageStack,
  Prose,
  formatRelative,
} from '@content-ventures/design-system/v3';
import { priorityOf } from '@/domain/hard-news';
import type { NewsItem } from '@/domain/hard-news';
import { PriorityBadge } from './priority-badge';
import { spread } from './radar-model';

/**
 * One story as a card (the radar's "Cobrir agora", Início's "Pauta do dia"): the outlet, the
 * headline, the AI's one-line why, the score, the topic and how far it spread. On the radar a
 * click selects it (the ficha opens beside); on Início it links to the desk.
 */
export function NewsCard({ item, now, selected = false, onSelect, href, showPriority = false }: {
  item: NewsItem;
  now: number;
  selected?: boolean;
  onSelect?: (id: string) => void;
  href?: string;
  showPriority?: boolean;
}) {
  const priority = priorityOf(item);
  const { outlets, lastHour } = spread(item, now);
  const at = new Date(Math.min(Date.parse(item.publishedAt), now));
  return (
    <Card as="div" padding="md" interactive selected={selected} data-testid={`news-card-${item.id}`}>
      <PageStack>
        <CardHeader
          titleAs="h3"
          leading={<BrandMark name={item.source} src={newsLogoUrl(item.url)} size="sm" decorative />}
          title={href
            ? <CardLink href={href}>{item.title}</CardLink>
            : <CardLink onClick={() => onSelect?.(item.id)} aria-current={selected ? 'true' : undefined}>{item.title}</CardLink>}
          description={`${item.source} · ${formatRelative(at, new Date(now))}`}
        />
        {item.classification ? <Prose variant="compact" measure="wide">{item.classification.summary}</Prose> : null}
        <MetaList
          size="sm"
          items={[
            showPriority && priority ? <PriorityBadge key="priority" priority={priority} size="sm" /> : null,
            item.classification ? { value: `Nota ${item.classification.score}`, numeric: true } : null,
            item.classification?.topic ?? null,
            outlets > 1 ? `${outlets} veículos` : null,
            lastHour > 0
              ? <Delta key="spread" variant="text" trend="up" tone="flat" value={`+${lastHour} em 1 h`} label={`${lastHour} ${lastHour === 1 ? 'veículo' : 'veículos'} a mais na última hora`} />
              : null,
          ]}
        />
      </PageStack>
    </Card>
  );
}
