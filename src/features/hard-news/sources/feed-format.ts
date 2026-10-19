import { FEED_INTERVALS } from '@/domain/hard-news';
import type { FeedState, NewsFeed } from '@/domain/hard-news';

/** "A cada 15 min", "A cada 1 h", "A cada 6 h". */
export function intervalLabel(minutes: number): string {
  return minutes < 60 ? `A cada ${minutes} min` : `A cada ${Math.round(minutes / 60)} h`;
}

export const INTERVAL_OPTIONS = FEED_INTERVALS.map((minutes) => ({ value: String(minutes), label: intervalLabel(minutes) }));

export const DEFAULT_INTERVAL = 60;

export const FEED_STATE: Record<FeedState, { label: string; tone: 'green' | 'gray' | 'red' }> = {
  active: { label: 'Ativa', tone: 'green' },
  paused: { label: 'Pausada', tone: 'gray' },
  failing: { label: 'Com falha', tone: 'red' },
};

/** "observatoriodopescado.exemplo": the feed's site, without "www.". */
export function feedHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** What a source follows, under its name: the site, the alert's or RSS.app's keyword. */
export function feedOrigin(feed: Pick<NewsFeed, 'url' | 'kind' | 'site' | 'keyword'>): string {
  if (feed.kind === 'google-alerts') return feed.keyword ? `Google Alertas · ${feed.keyword}` : 'Google Alertas';
  if (feed.kind === 'rss-app') return feed.keyword ? `RSS.app · ${feed.keyword}` : `RSS.app · ${feedHost(feed.site ?? feed.url)}`;
  return feedHost(feed.url);
}

/** The same rule the desk applies to addresses: a full http(s) address. */
export function isWebAddress(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
