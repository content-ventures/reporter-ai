import type { NewsFeed, NewsItem } from '../domain/hard-news.ts';
import type { NewsDiscoveryInput, NewsDiscoveryResult } from '../domain/news-discovery.ts';
import type { NewsDecisionInput } from '../domain/news-decisions.ts';

/**
 * F2.1 · Entrada de notícias: the desk's sources and the news they bring, on the server. The radar
 * polls `read(since)`; everything else is one call per person action. Refusals reject with the
 * desk's message (a source that does not answer, a duplicate, RSS.app's plan).
 */

/** Stable keyset within one poll; later mutations are caught by the next overlapping poll. */
export type NewsPageCursor = { updatedAt: string; id: string; until: string };

/** The radar's read. `sources` is absent when nothing about them changed since `since`. */
export type NewsSnapshot = {
  at: string;
  sources?: NewsFeed[];
  /** News changed since `since` (all of the last week on the first read), without their text. */
  items: NewsItem[];
  /** RSS.app can create feeds here (the platform's account is configured). */
  rssApp: boolean;
  next?: NewsPageCursor;
};

export type NewSource =
  /** An outlet's feed (or its site, whose feed is found) or a Google Alertas feed. */
  | { kind: 'rss'; url: string; name?: string; everyMinutes: number }
  | { kind: 'google-alerts'; url: string; keyword: string; everyMinutes: number }
  /** RSS.app makes the feed: of a site without one, or of a keyword's news. */
  | { kind: 'rss-app'; site: string; name?: string; everyMinutes: number }
  | { kind: 'rss-app'; keyword: string; everyMinutes: number };

export type SourcePatch = { name?: string; everyMinutes?: number; paused?: boolean };

/** What a read brought: new items, and stories that gained another outlet. */
export type SourceRead = { source: NewsFeed; inserted: number; grouped: number };

export type LinkImport = { id: string; outcome: 'inserted' | 'grouped' | 'repeat' };

export interface NewsIntake {
  /** Discover and verify candidate feeds without subscribing to any source. */
  discover(input: NewsDiscoveryInput): Promise<NewsDiscoveryResult>;
  decide(id: string, input: NewsDecisionInput): Promise<NewsItem>;
  read(since?: string, page?: NewsPageCursor): Promise<NewsSnapshot>;
  /** One item with its text. */
  item(id: string): Promise<NewsItem | undefined>;
  addSource(input: NewSource): Promise<SourceRead>;
  updateSource(id: string, patch: SourcePatch): Promise<NewsFeed>;
  /** "Tentar de novo": read now. */
  readSource(id: string): Promise<SourceRead>;
  removeSource(id: string): Promise<void>;
  /** "Colar link". */
  importLink(url: string): Promise<LinkImport>;
}
