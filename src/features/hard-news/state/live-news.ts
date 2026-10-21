import type { NewsFeed, NewsItem } from '../../../domain/hard-news.ts';
import type { NewsIntake, NewsPageCursor, NewsSnapshot } from '../../../ports/news-intake.ts';

/**
 * F2.1 in the connected build: the desk's sources and news from the server. The radar polls every
 * minute while the tab is visible, asking only for what changed since the last answer (with a
 * minute of overlap, so a read that committed during the poll is not missed). Every action merges
 * its answer at once and polls again.
 */

export type LiveNews = {
  ready: boolean;
  feeds: NewsFeed[];
  news: NewsItem[];
  /** RSS.app can create feeds (the platform's account is configured). */
  rssApp: boolean;
  /** The last poll failed; the previous records stay on screen. */
  failed: boolean;
};

export type LiveNewsStore = {
  get(): LiveNews;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  /** Merges one source (an action's answer) without waiting for the next poll. */
  putFeed(feed: NewsFeed): void;
  dropFeed(id: string): void;
  putItem(item: NewsItem): void;
  /** Reads the text of one item once (the ficha's "Texto original"). */
  loadBody(id: string): Promise<void>;
  /** A screen that shows the news keeps the polling on while it is mounted. */
  watch(): () => void;
};

export const POLL_MS = 60_000;
const OVERLAP_MS = 60_000;

const EMPTY: LiveNews = { ready: false, feeds: [], news: [], rssApp: false, failed: false };

/** Items by id: the newer answer wins, a loaded text survives a list update. */
export function mergeItems(current: readonly NewsItem[], incoming: readonly NewsItem[]): NewsItem[] {
  if (!incoming.length) return current as NewsItem[];
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    const known = byId.get(item.id);
    const stale = known && ((known.decisionRevision ?? 0) > (item.decisionRevision ?? 0)
      || (known.updatedAt && item.updatedAt && known.updatedAt > item.updatedAt));
    const latest = stale ? known : item;
    const full = item.paragraphs === undefined ? item : known?.paragraphs === undefined ? known : undefined;
    byId.set(item.id, full ? { ...latest, body: full.body, paragraphs: undefined } : latest);
  }
  return [...byId.values()];
}

export function createLiveNewsStore(port: NewsIntake, now: () => number = Date.now): LiveNewsStore {
  let snapshot = EMPTY;
  let cursor: string | undefined;
  let inflight: Promise<void> | undefined;
  let refreshQueued = false;
  let sourceVersion = 0;
  const sourceChanges = new Map<string, { version: number; feed?: NewsFeed }>();
  let watchers = 0;
  let stop: (() => void) | undefined;
  const loading = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  const set = (next: LiveNews) => {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };
  const accept = (answer: NewsSnapshot, readVersion: number) => {
    let feeds = snapshot.feeds;
    if (answer.sources) {
      const byId = new Map(answer.sources.map(feed => [feed.id, feed]));
      for (const [id, change] of sourceChanges) {
        if (change.version <= readVersion) sourceChanges.delete(id);
        else if (change.feed) byId.set(id, change.feed);
        else byId.delete(id);
      }
      feeds = [...byId.values()];
    }
    set({
      ready: true,
      failed: false,
      rssApp: answer.rssApp,
      feeds,
      news: mergeItems(snapshot.news, answer.items),
    });
  };
  const refresh = () => {
    if (inflight) {
      // Coalesce callers into one pending poll, started after their mutations completed.
      refreshQueued = true;
      return inflight;
    }
    inflight = (async () => {
      do {
        refreshQueued = false;
        let page: NewsPageCursor | undefined;
        const seen = new Set<string>();
        try {
          do {
            const readVersion = sourceVersion;
            const answer = await port.read(cursor, page);
            accept(answer, readVersion);
            page = answer.next;
            if (page) {
              const key = JSON.stringify(page);
              if (seen.has(key)) throw new Error('NEWS_PAGE_REPEATED');
              seen.add(key);
            } else {
              // Advance only after every page arrived. Failed reads retry the same window.
              cursor = new Date(Date.parse(answer.at) - OVERLAP_MS).toISOString();
            }
          } while (page);
        } catch {
          set({ ...snapshot, ready: true, failed: true });
        }
      } while (refreshQueued);
    })().finally(() => { inflight = undefined; });
    return inflight;
  };
  const store: LiveNewsStore = {
    get: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,
    putFeed(feed) {
      sourceChanges.set(feed.id, { version: ++sourceVersion, feed });
      const known = snapshot.feeds.some((item) => item.id === feed.id);
      set({ ...snapshot, feeds: known ? snapshot.feeds.map((item) => (item.id === feed.id ? feed : item)) : [...snapshot.feeds, feed] });
    },
    dropFeed(id) {
      sourceChanges.set(id, { version: ++sourceVersion });
      set({ ...snapshot, feeds: snapshot.feeds.filter((item) => item.id !== id) });
    },
    putItem(item) { set({ ...snapshot, news: mergeItems(snapshot.news, [item]) }); },
    async loadBody(id) {
      const known = snapshot.news.find((item) => item.id === id);
      if (known && known.paragraphs === undefined) return;
      const pending = loading.get(id);
      if (pending) return pending;
      const request = (async () => {
        const item = await port.item(id);
        if (!item) throw new Error('Esta notícia não está mais disponível.');
        set({ ...snapshot, news: mergeItems(snapshot.news, [{ ...item, paragraphs: undefined }]) });
      })().finally(() => {
        loading.delete(id);
      });
      loading.set(id, request);
      return request;
    },
    watch() {
      watchers += 1;
      if (watchers === 1) stop = start();
      return () => {
        watchers -= 1;
        if (watchers === 0) { stop?.(); stop = undefined; }
      };
    },
  };
  return store;

  /** Polls while watched: right away, then every minute the tab is visible. */
  function start() {
    void refresh();
    // A hidden tab stops polling, so a forgotten tab does not keep the database awake.
    let last = now();
    const timer = setInterval(() => {
      if (globalThis.document?.visibilityState === 'hidden' || now() - last < POLL_MS) return;
      last = now();
      void refresh();
    }, 5_000);
    const visible = () => {
      if (globalThis.document?.visibilityState === 'visible' && now() - last >= POLL_MS) { last = now(); void refresh(); }
    };
    globalThis.document?.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(timer);
      globalThis.document?.removeEventListener('visibilitychange', visible);
    };
  }
}
