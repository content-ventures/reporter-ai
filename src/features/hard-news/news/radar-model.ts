import type { ChartColor } from '@content-ventures/design-system/v3';
import { priorityOf } from '../../../domain/hard-news.ts';
import type { NewsFeed, NewsItem, NewsPriority } from '../../../domain/hard-news.ts';
import { matchesQuery } from './news-model.ts';

/**
 * Pure rules of the news radar (F2.1, F2.2, F2.4): what is on the board, in which group, what the
 * strip counts, the arrivals per hour and the sources' health. Every function takes `now`.
 */

/** Priority as color on the radar: orange asks for action now; red stays for failures. */
export const PRIORITY_COLOR: Record<NewsPriority, ChartColor> = { high: 'orange', medium: 'amber', low: 'gray' };

/** When the item reached the desk: its return to the queue, else its import. */
export function arrivedAt(item: Pick<NewsItem, 'importedAt' | 'returnedAt'>): string {
  return item.returnedAt ?? item.importedAt;
}

const time = (iso: string | undefined) => (iso ? Date.parse(iso) : 0);
const newestFirst = (a: NewsItem, b: NewsItem) => time(arrivedAt(b)) - time(arrivedAt(a));

/** Stories waiting for a decision that match the search, newest arrival first. */
export function queueOf(news: readonly NewsItem[], query: string): NewsItem[] {
  return news.filter((item) => item.status === 'new' && matchesQuery(item, query)).sort(newestFirst);
}

/**
 * "Cobrir agora": the high-priority stories, best score first (then the newest), up to `limit`.
 * `overflow` is how many high-priority stories stay in the wire.
 */
export function heroOf(queue: readonly NewsItem[], limit: number): { hero: NewsItem[]; overflow: number } {
  const high = queue
    .filter((item) => priorityOf(item) === 'high')
    .sort((a, b) => (b.classification?.score ?? 0) - (a.classification?.score ?? 0) || newestFirst(a, b));
  return { hero: high.slice(0, limit), overflow: Math.max(0, high.length - limit) };
}

export type WireGroupId = 'new' | 'hour' | 'today' | 'yesterday' | 'older';
export type WireGroup = { id: WireGroupId; label: string; items: NewsItem[] };

function startOfDay(at: number): number {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/** The wire, by arrival: new since the last look, the last hour, today, yesterday, before. */
export function wireGroups(items: readonly NewsItem[], since: string, now: number): WireGroup[] {
  const seen = time(since);
  const today = startOfDay(now);
  const yesterday = today - 86_400_000;
  const label: Record<WireGroupId, string> = {
    new: `Novas ${sinceLabel(since, now)}`,
    hour: 'Última hora',
    today: 'Hoje',
    yesterday: 'Ontem',
    older: 'Anteriores',
  };
  const groupOf = (item: NewsItem): WireGroupId => {
    const at = time(arrivedAt(item));
    if (at > seen) return 'new';
    if (now - at <= 3_600_000) return 'hour';
    if (at >= today) return 'today';
    if (at >= yesterday) return 'yesterday';
    return 'older';
  };
  const order: WireGroupId[] = ['new', 'hour', 'today', 'yesterday', 'older'];
  const sorted = [...items].sort(newestFirst);
  return order
    .map((id) => ({ id, label: label[id], items: sorted.filter((item) => groupOf(item) === id) }))
    .filter((group) => group.items.length > 0);
}

/** Decided stories that match the search, the latest decision first. */
export function decidedOf(news: readonly NewsItem[], query: string): NewsItem[] {
  return news
    .filter((item) => item.status !== 'new' && matchesQuery(item, query))
    .sort((a, b) => time(b.decidedAt ?? arrivedAt(b)) - time(a.decidedAt ?? arrivedAt(a)));
}

/** A story waiting more than this is flagged on the strip. */
export const WAITING_TOO_LONG_MS = 2 * 3_600_000;

export type Pulse = {
  /** Arrived after the last look. */
  fresh: { count: number; newestId?: string };
  high: { count: number; oldestId?: string; oldestAt?: string; waitingTooLong: number };
  feeds: { active: number; total: number; failing: number };
};

/** What the radar strip counts. */
export function pulse(news: readonly NewsItem[], feeds: readonly NewsFeed[], since: string, now: number): Pulse {
  const queue = news.filter((item) => item.status === 'new');
  const fresh = queue.filter((item) => time(arrivedAt(item)) > time(since)).sort(newestFirst);
  const high = queue.filter((item) => priorityOf(item) === 'high').sort((a, b) => time(arrivedAt(a)) - time(arrivedAt(b)));
  const oldest = high[0];
  return {
    fresh: { count: fresh.length, newestId: fresh[0]?.id },
    high: {
      count: high.length,
      oldestId: oldest?.id,
      oldestAt: oldest ? arrivedAt(oldest) : undefined,
      waitingTooLong: high.filter((item) => now - time(arrivedAt(item)) > WAITING_TOO_LONG_MS).length,
    },
    feeds: {
      active: feeds.filter((feed) => feed.state === 'active').length,
      total: feeds.length,
      failing: feeds.filter((feed) => feed.state === 'failing').length,
    },
  };
}

export type HourBucket = { label: string; title: string; values: Record<NewsPriority, number> };

/** Arrivals per hour over the last `hours` (the current hour last), by the AI's priority. */
export function hourly(news: readonly NewsItem[], now: number, hours = 12): HourBucket[] {
  const current = new Date(now);
  current.setMinutes(0, 0, 0);
  const buckets: HourBucket[] = [];
  for (let index = hours - 1; index >= 0; index -= 1) {
    const start = new Date(current.getTime() - index * 3_600_000);
    const day = `${String(start.getDate()).padStart(2, '0')}/${String(start.getMonth() + 1).padStart(2, '0')}`;
    buckets.push({ label: `${start.getHours()}h`, title: `${day} · ${start.getHours()}h`, values: { high: 0, medium: 0, low: 0 } });
  }
  const first = current.getTime() - (hours - 1) * 3_600_000;
  for (const item of news) {
    const priority = priorityOf(item);
    const at = time(arrivedAt(item));
    if (!priority || at < first || at > now) continue;
    const bucket = buckets[Math.floor((at - first) / 3_600_000)];
    if (bucket) bucket.values[priority] += 1;
  }
  return buckets;
}

/** Sources for the radar: failing first, then the active ones by last read, then the paused. */
export function feedRows(feeds: readonly NewsFeed[]): NewsFeed[] {
  const rank = { failing: 0, active: 1, paused: 2 } as const;
  return [...feeds].sort((a, b) => rank[a.state] - rank[b.state] || time(b.lastReadAt) - time(a.lastReadAt));
}

/** The newest read among the sources (the radar's "Lido há 1 min"). */
export function lastRead(feeds: readonly NewsFeed[]): string | undefined {
  return feeds.map((feed) => feed.lastReadAt).filter((at): at is string => Boolean(at)).sort().at(-1);
}

/** How far a story spread: outlets that ran it, and how many joined in the last hour. */
export function spread(item: Pick<NewsItem, 'duplicates'>, now: number): { outlets: number; lastHour: number } {
  return {
    outlets: 1 + item.duplicates.length,
    lastHour: item.duplicates.filter((duplicate) => now - time(duplicate.publishedAt) <= 3_600_000).length,
  };
}

const clock = (at: Date) => `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;

/** "desde 14:20" today, "desde ontem, 18:40", else "desde 12/10". */
export function sinceLabel(since: string, now: number): string {
  const at = new Date(time(since));
  const today = startOfDay(now);
  if (at.getTime() >= today) return `desde ${clock(at)}`;
  if (at.getTime() >= today - 86_400_000) return `desde ontem, ${clock(at)}`;
  return `desde ${String(at.getDate()).padStart(2, '0')}/${String(at.getMonth() + 1).padStart(2, '0')}`;
}

/** When a postponed story comes back: "Volta em 40 min", "Volta em 12 h", "Volta em 3 dias". */
export function returnLabel(laterUntil: string, now: number): string {
  const minutes = Math.max(1, Math.round((time(laterUntil) - now) / 60_000));
  if (minutes < 60) return `Volta em ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `Volta em ${hours} h`;
  return `Volta em ${Math.round(hours / 24)} dias`;
}

/** "há 48 min" for a wait (the strip's hint), never "agora". */
export function waitLabel(at: string, now: number): string {
  const minutes = Math.max(1, Math.round((now - time(at)) / 60_000));
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `há ${hours} h` : `há ${Math.round(hours / 24)} dias`;
}
