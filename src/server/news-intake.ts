import 'server-only';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import { FEED_INTERVALS } from '../domain/hard-news.ts';
import type { NewsFeed, NewsItem, NewsTranslation } from '../domain/hard-news.ts';
import { canonicalUrl, feedStateOf, isNewsAddress, NEWS_LIMITS, newsMessage, normalizeEntry, sourceKindOf } from '../domain/news-intake.ts';
import type { NewsSourceKind, NormalizedNews } from '../domain/news-intake.ts';
import { isRateableNewsSource } from '../domain/news-source-rating.ts';
import type { SourceRating } from '../domain/news-source-rating.ts';
import type { LinkImport, NewsPageCursor, NewsSnapshot, SourcePatch, SourceRead } from '../ports/news-intake.ts';
import { transaction } from './database.ts';
import { FlowError, logEvent, safeCode } from './errors.ts';
import { fetchText } from './news-fetch.ts';
import { discoverFeeds, parseArticlePage, parseFeed } from './news-parse.ts';
import type { ParsedFeed } from './news-parse.ts';
import { claimSource, entriesFor, FEED_ACCEPT, ingest, markFailed, readSource } from './news-reader.ts';
import type { NewsClaim, ReadResult } from './news-reader.ts';
import { createRssAppFeed, deleteRssAppFeed, rssAppConfigured } from './rss-app.ts';
import { newsTranslationConfigured } from './news-translation.ts';
import { privateAddress } from './public-address.ts';

/** F2.1 routes under `/api/reporter/news`. Reads need membership; every write needs `reporter.edit` (checked in SQL). */

type StoredSource = {
  id: string; kind: NewsSourceKind; name: string; url: string; site?: string; keyword?: string; everyMinutes: number;
  paused: boolean; failures: number; lastError?: string; lastReadAt?: string; lastWeek?: number[];
  rating?: SourceRating;
};
export type StoredItem = {
  id: string; sourceId?: string; via: 'rss' | 'url'; url: string; title: string; outlet: string; excerpt: string;
  publishedAt: string; importedAt: string; updatedAt?: string; duplicates: { source: string; url: string; publishedAt: string }[];
  paragraphs: number; body?: string[]; imageUrl?: string;
  status?: 'new' | 'selected' | 'later' | 'discarded'; decisionRevision?: number;
  decidedBy?: string; decidedAt?: string; laterUntil?: string; discardReason?: string; returnedAt?: string;
  translation?: NewsTranslation & { title?: string; excerpt?: string; body?: string[] };
};

const iso = (value: string | undefined) => (value ? new Date(value).toISOString() : undefined);

/** Image display validates the supplied address without an extra fetch or DNS lookup. */
function newsImageUrl(value: string | undefined): string | undefined {
  const image = value?.trim();
  if (!image || !isNewsAddress(image)) return undefined;
  const hostname = new URL(image).hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === 'local' || hostname.endsWith('.local')
    || isIP(hostname) && privateAddress(hostname)) return undefined;
  return image;
}

export function feedView(source: StoredSource): NewsFeed {
  const lastWeek = source.lastWeek ?? [];
  return {
    id: source.id,
    name: source.name,
    url: source.url,
    everyMinutes: source.everyMinutes,
    state: !source.paused && !source.lastReadAt && source.lastError ? 'failing' : feedStateOf(source),
    ...(source.lastReadAt ? { lastReadAt: iso(source.lastReadAt) } : {}),
    ...(source.lastError ? { lastError: newsMessage(source.lastError) } : {}),
    lastDay: lastWeek.at(-1) ?? 0,
    lastWeek,
    kind: source.kind,
    ...(source.site ? { site: source.site } : {}),
    ...(source.keyword ? { keyword: source.keyword } : {}),
    ...(source.rating ? { rating: { ...source.rating, updatedAt: iso(source.rating.updatedAt)! } } : {}),
  };
}

export function itemView(item: StoredItem): NewsItem {
  const translated = item.translation?.status === 'translated' ? item.translation : undefined;
  const excerpt = translated?.excerpt ?? item.excerpt;
  const body = translated ? translated.body ?? (excerpt ? [excerpt] : []) : item.body ?? (excerpt ? [excerpt] : []);
  const translation = item.translation;
  const imageUrl = newsImageUrl(item.imageUrl);
  return {
    id: item.id,
    title: translated?.title ?? item.title,
    url: item.url,
    ...(imageUrl ? { imageUrl } : {}),
    source: item.outlet,
    ...(item.sourceId ? { feedId: item.sourceId } : {}),
    via: item.via,
    contentKind: item.via === 'rss' ? 'feed' : 'article',
    publishedAt: iso(item.publishedAt)!,
    importedAt: iso(item.importedAt)!,
    ...(item.updatedAt ? { updatedAt: iso(item.updatedAt) } : {}),
    excerpt,
    body,
    ...(translation ? { translation: { status: translation.status, targetLanguage: 'pt-BR' as const,
      ...(translation.sourceLanguage ? { sourceLanguage: translation.sourceLanguage } : {}),
      ...(translation.error ? { error: translation.error } : {}) } } : {}),
    ...(item.body ? {} : { paragraphs: item.paragraphs }),
    duplicates: item.duplicates.map((duplicate) => ({ source: duplicate.source, url: duplicate.url, publishedAt: iso(duplicate.publishedAt)! })),
    status: item.status ?? 'new',
    decisionRevision: item.decisionRevision ?? 0,
    ...(item.decidedBy ? { decidedBy: item.decidedBy } : {}),
    ...(item.decidedAt ? { decidedAt: iso(item.decidedAt) } : {}),
    ...(item.laterUntil ? { laterUntil: iso(item.laterUntil) } : {}),
    ...(item.discardReason ? { discardReason: item.discardReason } : {}),
    ...(item.returnedAt ? { returnedAt: iso(item.returnedAt) } : {}),
  };
}

async function sql<T>(query: string, values: unknown[]): Promise<T> {
  try {
    return await transaction('runtime', async (client) => (await client.query(query, values)).rows[0]?.value as T);
  } catch (error) {
    // The SQL names its own refusals; they reach the desk as words.
    const message = error instanceof Error ? error.message : '';
    if (/^NEWS_[A-Z_]+$/.test(message)) throw new FlowError(message, ['NEWS_SOURCE_NOT_FOUND', 'NEWS_ITEM_NOT_FOUND'].includes(message) ? 404 : message === 'NEWS_SOURCE_DUPLICATE' ? 409 : 422);
    throw error;
  }
}

/** Refuse a reader before fetching a site or spending the platform's RSS.app account. */
export async function requireNewsEdit(): Promise<void> {
  await sql('SELECT public.reporter_news_require_edit() AS value', []);
}

const INTERVAL = z.number().int().refine((value) => (FEED_INTERVALS as readonly number[]).includes(value));
const ADDRESS = z.string().trim().max(2000).refine(isNewsAddress, 'NEWS_URL_INVALID');
const NAME = z.string().trim().max(120).optional();
const NewSource = z.union([
  z.object({ kind: z.literal('rss'), url: ADDRESS, name: NAME, everyMinutes: INTERVAL }).strict(),
  z.object({ kind: z.literal('google-alerts'), url: ADDRESS, keyword: z.string().trim().min(1).max(200), everyMinutes: INTERVAL }).strict(),
  z.object({ kind: z.literal('rss-app'), site: ADDRESS, name: NAME, everyMinutes: INTERVAL }).strict(),
  z.object({ kind: z.literal('rss-app'), keyword: z.string().trim().min(1).max(200), everyMinutes: INTERVAL }).strict(),
]);
const Rating = z.object({
  tier: z.enum(['A1', 'A2', 'B', 'C']), relevance: z.enum(['high', 'medium', 'low']),
  rationale: z.string().trim().min(1).max(600),
}).strict();
const Patch = z.object({ name: z.string().trim().min(1).max(120).optional(), everyMinutes: INTERVAL.optional(),
  paused: z.boolean().optional(), rating: Rating.nullable().optional() }).strict();
const UUID = z.string().uuid();
const TIMESTAMP = z.string().max(64).datetime({ offset: true });
const PageCursor = z.object({ updatedAt: TIMESTAMP, id: UUID, until: TIMESTAMP }).strict()
  .refine(value => Date.parse(value.updatedAt) <= Date.parse(value.until));

function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new FlowError(result.error.issues.some((issue) => issue.message === 'NEWS_URL_INVALID') ? 'NEWS_URL_INVALID' : 'INVALID_INPUT', 422);
}

/** The cursor is bounded input, and its timestamp strings retain PostgreSQL microseconds. */
export function parseNewsPageCursor(value: string | undefined): NewsPageCursor | undefined {
  if (value === undefined) return undefined;
  if (value.length > 512) throw new FlowError('INVALID_INPUT', 422);
  let decoded: unknown;
  try { decoded = JSON.parse(value); } catch { throw new FlowError('INVALID_INPUT', 422); }
  return parsed(PageCursor, decoded);
}

export type NewsServices = {
  requireEdit: () => Promise<void>;
  fetch: typeof fetchText;
  createRssApp: typeof createRssAppFeed;
  deleteRssApp: typeof deleteRssAppFeed;
  rssApp: () => boolean;
  now: () => number;
};
const services: NewsServices = { requireEdit: requireNewsEdit, fetch: fetchText, createRssApp: createRssAppFeed, deleteRssApp: deleteRssAppFeed, rssApp: () => rssAppConfigured(), now: Date.now };

/**
 * The feed behind an address: the address itself when it is a feed, else the feed its page
 * announces (`<link rel="alternate">`), so "the site's address" works for most outlets.
 */
export async function resolveFeed(address: string, deps: Pick<NewsServices, 'fetch'> = services): Promise<{ url: string; feed: ParsedFeed; etag?: string; lastModified?: string }> {
  const first = await deps.fetch(address, { maxBytes: NEWS_LIMITS.feedBytes, accept: FEED_ACCEPT });
  if (first.status !== 200) throw new FlowError('NEWS_FEED_INVALID', 422);
  const direct = parseFeed(first.text);
  if (direct) return { url: first.url, feed: direct, etag: first.etag, lastModified: first.lastModified };
  for (const candidate of discoverFeeds(first.text, first.url).slice(0, 2)) {
    const fetched = await deps.fetch(candidate, { maxBytes: NEWS_LIMITS.feedBytes, accept: FEED_ACCEPT }).catch(() => undefined);
    const feed = fetched?.status === 200 ? parseFeed(fetched.text) : undefined;
    if (fetched?.status === 200 && feed) return { url: fetched.url, feed, etag: fetched.etag, lastModified: fetched.lastModified };
  }
  throw new FlowError('NEWS_FEED_INVALID', 422);
}

async function addSourceRow(input: { kind: NewsSourceKind; name: string; url: string; every: number; site?: string; keyword?: string; remoteId?: string }): Promise<StoredSource> {
  const canonical = canonicalUrl(input.url);
  if (!canonical) throw new FlowError('NEWS_URL_INVALID', 422);
  return sql<StoredSource>('SELECT public.reporter_news_source_add($1,$2,$3,$4,$5,$6,$7,$8) AS value',
    [input.kind, input.name.slice(0, 120), input.url, canonical, input.every, input.site ?? null, input.keyword ?? null, input.remoteId ?? null]);
}

/** The first read of a new source, from what was already fetched to validate it. */
export async function firstRead(source: StoredSource, entries: NormalizedNews[] | ((claim: NewsClaim) => NormalizedNews[]), validators: { etag?: string; lastModified?: string },
  deps = { claim: claimSource, ingest, failed: markFailed, source: sourceById }): Promise<SourceRead> {
  const owner = `news-add-${randomUUID()}`;
  const claim = await deps.claim('runtime', owner, source.id);
  let result: ReadResult = { inserted: 0, grouped: 0 };
  if (claim) {
    try {
      result = await deps.ingest('runtime', claim, owner, typeof entries === 'function' ? entries(claim) : entries, validators);
    } catch (error) {
      // The source is already saved: show it with a retryable read failure instead of asking
      // the editor to create it again (which would only fail as a duplicate).
      await deps.failed('runtime', claim, owner, error instanceof FlowError ? error.code : safeCode(error));
    }
  }
  return { source: feedView(await deps.source(source.id)), ...result };
}

async function sourceById(id: string): Promise<StoredSource> {
  const view = await sql<{ sources?: StoredSource[] }>('SELECT public.reporter_news_view(NULL,1) AS value', []);
  const source = view.sources?.find((item) => item.id === id);
  if (!source) throw new FlowError('NEWS_SOURCE_NOT_FOUND', 404);
  return source;
}

const hostName = (url: string) => new URL(url).hostname.replace(/^www\./, '');

export async function addSource(value: unknown, deps: NewsServices = services): Promise<SourceRead> {
  await deps.requireEdit();
  const input = parsed(NewSource, value);
  if (input.kind === 'rss-app') {
    if (!deps.rssApp()) throw new FlowError('RSS_APP_UNCONFIGURED', 422);
    const created = await deps.createRssApp('site' in input ? { url: input.site } : { keyword: input.keyword });
    let source: StoredSource;
    try {
      const name = 'site' in input ? input.name || created.title || hostName(input.site) : input.keyword;
      source = await addSourceRow({ kind: 'rss-app', name, url: created.feedUrl, every: input.everyMinutes,
        site: 'site' in input ? input.site : undefined, keyword: 'keyword' in input ? input.keyword : undefined, remoteId: created.id });
    } catch (error) {
      // The desk refused it (duplicate, limit): the feed made for it would only spend the plan.
      await deps.deleteRssApp(created.id).catch(() => {});
      throw error;
    }
    // Once saved, a temporary first-read failure must not delete the feed the source points at.
    return firstRead(source, (claim) => entriesFor(claim, created.entries, deps.now()), {});
  }
  const kind = input.kind === 'google-alerts' ? 'google-alerts' : sourceKindOf(input.url);
  const resolved = await resolveFeed(input.url, deps);
  const name = input.kind === 'google-alerts' ? input.keyword : input.name || resolved.feed.title || hostName(resolved.url);
  const source = await addSourceRow({ kind, name, url: resolved.url, every: input.everyMinutes, keyword: input.kind === 'google-alerts' ? input.keyword : undefined });
  return firstRead(source, (claim) => entriesFor(claim, resolved.feed.entries, deps.now()), resolved);
}

export async function readSourceNow(id: string, deps: Pick<NewsServices, 'requireEdit'> = services): Promise<SourceRead> {
  await deps.requireEdit();
  const owner = `news-read-${randomUUID()}`;
  const claim = await claimSource('runtime', owner, id);
  // Another read holds the source: its result arrives with the next poll.
  if (!claim) return { source: feedView(await sourceById(id)), inserted: 0, grouped: 0 };
  const result = await readSource('runtime', claim, owner);
  return { source: feedView(await sourceById(id)), ...result };
}

export async function removeSource(id: string, deps: NewsServices = services): Promise<void> {
  await deps.requireEdit();
  const removed = await sql<{ kind: NewsSourceKind; remoteId?: string } | null>('SELECT public.reporter_news_source_remove($1) AS value', [id]);
  if (removed?.remoteId && deps.rssApp()) {
    await deps.deleteRssApp(removed.remoteId).catch((error) => logEvent('api', 'rss_app_delete_failed', { error_code: safeCode(error) }));
  }
}

/** "Colar link": the page, normalized and placed in the queue (or on the story already there). */
export async function importLink(value: unknown, deps: NewsServices = services): Promise<LinkImport> {
  await deps.requireEdit();
  const { url } = parsed(z.object({ url: ADDRESS }).strict(), value);
  // A link already in the queue opens its story, even when the site refuses to be read.
  const canonical = canonicalUrl(url);
  const known = canonical ? await sql<string | null>('SELECT public.reporter_news_lookup($1) AS value', [canonical]) : null;
  if (known) return { id: known, outcome: 'repeat' };
  const page = await deps.fetch(url, { maxBytes: NEWS_LIMITS.pageBytes, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' });
  if (page.status !== 200) throw new FlowError('NEWS_PAGE_INVALID', 422);
  const entry = parseArticlePage(page.text, page.url);
  const item = entry ? normalizeEntry(entry, { now: deps.now() }) : undefined;
  if (!item) throw new FlowError('NEWS_PAGE_INVALID', 422);
  return sql<LinkImport>('SELECT public.reporter_news_import($1) AS value', [JSON.stringify(item)]);
}

async function updateSourceRow(id: string, patch: SourcePatch): Promise<StoredSource> {
  return sql<StoredSource>('SELECT public.reporter_news_source_update($1,$2,$3,$4,$5::jsonb) AS value',
    [id, patch.name ?? null, patch.everyMinutes ?? null, patch.paused ?? null,
      patch.rating === undefined ? null : JSON.stringify(patch.rating)]);
}

export async function updateSource(id: string, value: unknown, deps: Pick<NewsServices, 'requireEdit'> & {
  source?: typeof sourceById; write?: typeof updateSourceRow;
} = services): Promise<NewsFeed> {
  await deps.requireEdit();
  const patch = parsed(Patch, value);
  parsed(UUID, id);
  if (patch.rating && !isRateableNewsSource(await (deps.source ?? sourceById)(id))) {
    throw new FlowError('NEWS_SOURCE_RATING_UNSUPPORTED', 422);
  }
  const source = await (deps.write ?? updateSourceRow)(id, patch);
  return feedView(source);
}

export async function newsSnapshot(since: string | undefined, page?: NewsPageCursor, deps: Pick<NewsServices, 'rssApp'> = services): Promise<NewsSnapshot & { due: boolean }> {
  const value = await sql<{ at: string; sources: StoredSource[] | null; items: StoredItem[]; next?: NewsPageCursor; due: boolean }>(
    'SELECT public.reporter_news_page($1,$2,$3,$4,$5) AS value',
    [since ?? null, page?.updatedAt ?? null, page?.id ?? null, page?.until ?? null, 400]);
  return {
    at: iso(value.at)!,
    ...(value.sources ? { sources: value.sources.map(feedView) } : {}),
    items: value.items.map(itemView),
    ...(value.next ? { next: value.next } : {}),
    rssApp: deps.rssApp(),
    due: value.due,
  };
}

const reply = (value: unknown) => Response.json(value, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

/** `wake` asks the worker to read the sources that are due (the radar is open, so someone is waiting). */
export async function handleNews(request: Request, path: string[], deps: { readJson: (request: Request) => Promise<unknown>; wake: () => void }) {
  try {
    return await route(request, path, deps);
  } catch (error) {
    // A site's HTTP refusal reaches the desk in words ("O site recusou a leitura automática.").
    if (error instanceof FlowError && /^HTTP_\d{3}$/.test(error.code)) error.reason = newsMessage(error.code);
    throw error;
  }
}

async function route(request: Request, path: string[], deps: { readJson: (request: Request) => Promise<unknown>; wake: () => void }) {
  if (request.method === 'GET' && path.length === 0) {
    const params = new URL(request.url).searchParams;
    const since = params.has('since') ? parsed(TIMESTAMP, params.get('since')) : undefined;
    const page = parseNewsPageCursor(params.get('after') ?? undefined);
    const { due, ...snapshot } = await newsSnapshot(since, page);
    if (due) deps.wake();
    return reply(snapshot);
  }
  if (request.method === 'GET' && path.length === 2 && path[0] === 'items') {
    const value = await sql<StoredItem | null>('SELECT public.reporter_news_item($1) AS value', [parsed(UUID, path[1])]);
    if (value?.translation?.status === 'pending') deps.wake();
    return reply(value ? { item: itemView(value) } : {});
  }
  if (request.method !== 'POST') throw new FlowError('NOT_FOUND', 404);
  if (path.length === 4 && path[0] === 'items' && path[2] === 'translation' && path[3] === 'retry') {
    await requireNewsEdit();
    if (!newsTranslationConfigured()) throw new FlowError('NEWS_TRANSLATION_UNCONFIGURED', 503);
    const value = await sql<StoredItem>('SELECT public.reporter_news_translation_retry($1) AS value', [parsed(UUID, path[1])]);
    deps.wake();
    return reply(itemView(value));
  }
  if (path.length === 1 && path[0] === 'links') {
    const result = await importLink(await deps.readJson(request));
    deps.wake();
    return reply(result);
  }
  if (path[0] !== 'sources') throw new FlowError('NOT_FOUND', 404);
  if (path.length === 1) {
    const result = await addSource(await deps.readJson(request));
    deps.wake();
    return reply(result);
  }
  const id = parsed(UUID, path[1]);
  if (path.length === 2) {
    return reply(await updateSource(id, await deps.readJson(request)));
  }
  if (path.length === 3 && path[2] === 'read') {
    const result = await readSourceNow(id);
    deps.wake();
    return reply(result);
  }
  if (path.length === 3 && path[2] === 'remove') { await removeSource(id); return reply({ ok: true }); }
  throw new FlowError('NOT_FOUND', 404);
}
