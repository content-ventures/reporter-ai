import type { NewsFeed, NewsItem } from './hard-news.ts';
import { isRateableNewsSource } from './news-source-rating.ts';
import type { SourceTier } from './news-source-rating.ts';

export type SourceTierFilter = 'all' | 'unrated' | SourceTier;

function publisher(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined;
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch { return undefined; }
}

/** A feed rating belongs to its publisher, never to unrelated outlets in an alert. */
export function sourceForNews(item: Pick<NewsItem, 'feedId' | 'url'>, feeds: readonly NewsFeed[]): NewsFeed | undefined {
  const host = publisher(item.url);
  if (!host) return undefined;
  const samePublisher = (feed: NewsFeed) => isRateableNewsSource(feed) && publisher(feed.site ?? feed.url) === host;
  const direct = feeds.find(feed => feed.id === item.feedId);
  if (direct?.rating && samePublisher(direct)) return direct;
  return feeds.find(feed => samePublisher(feed) && feed.rating !== undefined)
    ?? (direct && samePublisher(direct) ? direct : undefined);
}

export function matchesSourceTier(item: Pick<NewsItem, 'feedId' | 'url'>, feeds: readonly NewsFeed[], tier: SourceTierFilter): boolean {
  if (tier === 'all') return true;
  const rating = sourceForNews(item, feeds)?.rating;
  return tier === 'unrated' ? !rating : rating?.tier === tier;
}
