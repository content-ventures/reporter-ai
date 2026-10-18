import type { NewsItem } from '../../../domain/hard-news.ts';

/** Pure view rules of the news desk: tabs, search and the next item after a decision. */

export type DeskTab = 'open' | 'decided';

export const DESK_TABS: { value: DeskTab; label: string }[] = [
  { value: 'open', label: 'Para decidir' },
  { value: 'decided', label: 'Decididas' },
];

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function matchesQuery(item: NewsItem, query: string): boolean {
  const wanted = normalize(query.trim());
  if (!wanted) return true;
  return normalize(`${item.title} ${item.source} ${item.classification?.topic ?? ''}`).includes(wanted);
}

/** After a decision, the next item down the board (or the one above when it was the last). */
export function nextAfter(ordered: readonly NewsItem[], id: string): string | undefined {
  const index = ordered.findIndex((item) => item.id === id);
  if (index < 0) return ordered[0]?.id;
  return ordered[index + 1]?.id ?? ordered[index - 1]?.id;
}

export const POSTPONE_OPTIONS = [
  { hours: 2, label: 'Por 2 horas' },
  { hours: 18, label: 'Até amanhã cedo' },
  { hours: 72, label: 'Por 3 dias' },
] as const;
