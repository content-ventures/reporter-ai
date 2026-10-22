'use client';

import { Fragment, type ReactNode } from 'react';
import { Badge, BrandMark, IconButton, ListItem, Menu } from '@content-ventures/design-system/v3';
import type { MenuSection } from '@content-ventures/design-system/v3';
import { Clock, Ellipsis, Undo2, X } from '@content-ventures/design-system/v3/icons';
import type { LucideIcon } from '@content-ventures/design-system/v3/icons';
import { DISCARD_REASONS, priorityOf } from '@/domain/hard-news';
import type { NewsItem } from '@/domain/hard-news';
import { newsLogoUrl } from '@/domain/news-branding';
import type { SourceRating } from '@/domain/news-source-rating';
import { SourceRatingBadge } from '../source-rating';
import { editionOutlets } from './edition-model';
import { POSTPONE_OPTIONS } from './news-model';
import { returnLabel, whenLabel } from './radar-model';

/** Facts of one line, apart by "·" (a meta list is a block and cannot sit inside a row). */
function line(parts: ReactNode[]): ReactNode {
  return parts.filter(part => part !== null && part !== undefined && part !== '')
    .map((part, index) => <Fragment key={index}>{index ? ' · ' : null}{part}</Fragment>);
}

/** How many outlets ran the story, when more than one did: the radar's sign that a story is spreading. */
export function spreadBadge(item: NewsItem): ReactNode {
  const outlets = editionOutlets(item);
  return outlets > 1 ? <Badge key="spread" tone="blue" size="sm">Em {outlets} veículos</Badge> : null;
}

/**
 * One story of the wire. Why it matters: new since the last look, the AI's priority and how many
 * outlets ran it. Where: the outlet's mark, name and strength. When: the time, in a column of its
 * own at the end of the row.
 * Every row leads with the same mark, so the headlines start on one line and read as a column.
 */
export function NewsRow({ item, rating, now, onSelect, actions, compact = false, fresh = false }: {
  item: NewsItem;
  rating?: SourceRating;
  now: number;
  onSelect: (id: string) => void;
  actions?: ReactNode;
  /** Phone: the time joins the facts line, so a row keeps two lines of text under the headline. */
  compact?: boolean;
  /** Arrived since the last look, outside the "Novas" group that already says so. */
  fresh?: boolean;
}) {
  const when = whenLabel(item.publishedAt, now);
  const decision = item.status === 'later' && item.laterUntil ? returnLabel(item.laterUntil, now)
    : item.status === 'discarded' ? item.discardReason : undefined;
  return (
    <ListItem
      data-testid={`news-card-${item.id}`}
      leading={<BrandMark name={item.source} src={newsLogoUrl(item.url)} size="lg" decorative />}
      title={item.title}
      titleLines={2}
      // Why first (new, the AI's priority, the spread), then where; on a phone the time joins them.
      description={line([
        fresh ? <Badge key="fresh" variant="text" tone="blue" dot>Nova</Badge> : null,
        priorityOf(item) === 'high' ? <Badge key="priority" tone="orange" size="sm">Prioridade alta</Badge> : null,
        spreadBadge(item),
        compact ? when : null,
        item.source,
        <SourceRatingBadge key="rating" rating={rating} compact />,
        decision,
      ])}
      meta={compact ? undefined : when}
      onClick={() => onSelect(item.id)}
      actions={actions}
    />
  );
}

export type RowDecisionProps = {
  item: NewsItem;
  /** The decision that moves a story on: "Selecionar para redação" (connected) or "Cobrir". */
  primary?: { label: string; icon: LucideIcon; onSelect: (item: NewsItem) => void };
  onPostpone?: (item: NewsItem, hours: number, label: string) => void;
  onDiscard?: (item: NewsItem, reason: string) => void;
  onRestore?: (item: NewsItem) => void;
  busy: boolean;
  /** Phone: every decision goes in "⋯", so the headline keeps the width. */
  compact: boolean;
};

/** The decisions a row offers without opening the story; a decided story only goes back to the queue. */
export function RowDecision({ item, primary, onPostpone, onDiscard, onRestore, busy, compact }: RowDecisionProps) {
  if (item.status !== 'new') {
    return onRestore ? <IconButton icon={Undo2} label="Voltar para a fila" variant="ghost" size="sm" loading={busy}
      onClick={() => onRestore(item)} /> : null;
  }
  const later: MenuSection | undefined = onPostpone ? { label: 'Adiar', items: POSTPONE_OPTIONS.map(option => ({
    label: option.label, icon: Clock, onSelect: () => onPostpone(item, option.hours, option.label),
  })) } : undefined;
  const discard: MenuSection | undefined = onDiscard ? { label: 'Descartar', items: DISCARD_REASONS.map(reason => ({
    label: reason, icon: X, onSelect: () => onDiscard(item, reason),
  })) } : undefined;
  const select = primary ? { label: primary.label, icon: primary.icon, onSelect: () => primary.onSelect(item) } : undefined;
  const sections = [...(compact && select ? [{ items: [select] }] : []), ...(later ? [later] : []), ...(discard ? [discard] : [])];
  return <>
    {!compact && select ? <IconButton icon={select.icon} label={select.label} variant="ghost" size="sm" loading={busy}
      onClick={select.onSelect} /> : null}
    {sections.length ? <Menu label={`Decidir: ${item.title}`} align="end" sections={sections}
      trigger={props => <IconButton {...props} icon={Ellipsis} label={compact ? 'Decidir' : 'Adiar ou descartar'} variant="ghost" size="sm"
        aria-disabled={busy || undefined} />} /> : null}
  </>;
}
