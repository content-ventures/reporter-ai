import { priorityOf, type NewsItem } from '../../../domain/hard-news.ts';

const DAY = 86_400_000;
const published = (item: NewsItem, now: number) => {
  const at = Date.parse(item.publishedAt);
  return Number.isFinite(at) && at <= now ? at : 0;
};

/** Distinct publishers, not duplicate records from the same feed. */
export function editionOutlets(item: NewsItem): number {
  const publishers = new Set<string>();
  for (const entry of [item, ...item.duplicates]) {
    try { publishers.add(new URL(entry.url).hostname.toLowerCase().replace(/^www\./, '')); }
    catch { /* An invalid URL cannot prove another publisher. */ }
  }
  return Math.max(1, publishers.size);
}

/** A cover suggestion, never a fabricated editorial score or a source-tier ranking. */
export function editionOrder(items: readonly NewsItem[], now: number, triage: boolean): NewsItem[] {
  const recent = (item: NewsItem) => published(item, now) > now - DAY;
  const priority = (item: NewsItem) => triage ? ({ high: 3, medium: 2, low: 1 }[priorityOf(item) ?? 'low']) : 0;
  const ranked = [...items].sort((a, b) => Number(recent(b)) - Number(recent(a))
    || priority(b) - priority(a)
    || (triage ? (b.classification?.score ?? 0) - (a.classification?.score ?? 0) : 0)
    || (recent(a) && recent(b) ? editionOutlets(b) - editionOutlets(a) : 0)
    || published(b, now) - published(a, now) || a.id.localeCompare(b.id));
  const highlights = ranked.slice(0, 4);
  const selected = new Set(highlights.map(item => item.id));
  return [...highlights, ...items.filter(item => !selected.has(item.id))
    .sort((a, b) => published(b, now) - published(a, now) || a.id.localeCompare(b.id))];
}

export function editionSignal(item: NewsItem, now: number, triage: boolean): string {
  const priority = triage ? priorityOf(item) : undefined;
  if (priority) return `Prioridade ${{ high: 'alta', medium: 'média', low: 'baixa' }[priority]}`;
  const outlets = editionOutlets(item);
  if (outlets > 1) return `Em ${outlets} veículos`;
  return published(item, now) > now - DAY ? 'Publicada nas últimas 24 h' : 'Publicação anterior';
}
