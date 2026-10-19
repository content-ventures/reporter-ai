import 'server-only';
import { z } from 'zod';
import type { RawNewsEntry } from '../domain/news-intake.ts';
import { FlowError, logEvent } from './errors.ts';

/**
 * RSS.app (F2.1): turns a site without a feed, or a keyword, into a feed. Only creating and
 * deleting a feed use the account's key; reading it is plain RSS (`rss_feed_url`), so the worker
 * needs no key. The key and secret are the platform's (`RSS_APP_API_KEY`, `RSS_APP_API_SECRET`).
 */

const BASE = 'https://api.rss.app/v1';
// Google News region of a keyword feed. The docs give only "US:en"; set RSS_APP_REGION if the
// account answers otherwise.
const DEFAULT_REGION = 'BR:pt-419';

type Environment = Readonly<Record<string, string | undefined>>;

export function rssAppConfigured(environment: Environment = process.env): boolean {
  return Boolean(environment.RSS_APP_API_KEY?.trim() && environment.RSS_APP_API_SECRET?.trim());
}

const Item = z.object({
  url: z.string().url(),
  title: z.string().nullish(),
  description_text: z.string().nullish(),
  date_published: z.string().nullish(),
  thumbnail: z.string().nullish(),
  authors: z.array(z.object({ name: z.string().nullish() }).passthrough()).nullish(),
}).passthrough();

const Feed = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  title: z.string().nullish(),
  source_url: z.string().nullish(),
  rss_feed_url: z.string().url(),
  items: z.array(z.unknown()).nullish(),
}).passthrough();

export type RssAppFeed = { id: string; title?: string; site?: string; feedUrl: string; entries: RawNewsEntry[] };

export type RssAppServices = { fetch: typeof fetch; environment: Environment };
const services: RssAppServices = { fetch: (input, init) => fetch(input, init), environment: process.env };

/** RSS.app's answer as a bounded code: the key, the plan, the address, or the service itself. */
async function failure(response: Response): Promise<FlowError> {
  const body = await response.text().catch(() => '');
  const limit = /limit|quota|plan|upgrade/i.test(body);
  logEvent('api', 'rss_app_failed', { error_code: `HTTP_${response.status}` });
  if (response.status === 401) return new FlowError('RSS_APP_AUTH', 502);
  if (limit || response.status === 403) return new FlowError('RSS_APP_LIMIT', 422);
  if (response.status === 429 || response.status >= 500) return new FlowError('RSS_APP_UNAVAILABLE', 503);
  return new FlowError('RSS_APP_REFUSED', 422);
}

async function call(path: string, init: RequestInit, deps: RssAppServices): Promise<Response> {
  if (!rssAppConfigured(deps.environment)) throw new FlowError('RSS_APP_UNCONFIGURED', 422);
  const key = deps.environment.RSS_APP_API_KEY!.trim(), secret = deps.environment.RSS_APP_API_SECRET!.trim();
  try {
    const response = await deps.fetch(BASE + path, {
      ...init,
      // Creating a feed makes RSS.app read the site first: it can take a while.
      signal: AbortSignal.timeout(45_000),
      headers: { authorization: `Bearer ${key}:${secret}`, 'content-type': 'application/json', accept: 'application/json' },
    });
    if (!response.ok) throw await failure(response);
    return response;
  } catch (error) {
    if (error instanceof FlowError) throw error;
    throw new FlowError('RSS_APP_UNAVAILABLE', 503);
  }
}

function entryOf(value: unknown): RawNewsEntry[] {
  const parsed = Item.safeParse(value);
  if (!parsed.success) return [];
  const item = parsed.data;
  return [{
    id: item.url,
    url: item.url,
    title: item.title ?? undefined,
    paragraphs: item.description_text ? item.description_text.split(/\n{2,}/) : [],
    publishedAt: item.date_published ?? undefined,
    image: item.thumbnail ?? undefined,
  }];
}

/** A feed of a site's page (`url`) or of a keyword's news in Brazil (`keyword`). */
export async function createRssAppFeed(input: { url: string } | { keyword: string }, deps: RssAppServices = services): Promise<RssAppFeed> {
  const body = 'url' in input ? { url: input.url } : { keyword: input.keyword, region: deps.environment.RSS_APP_REGION?.trim() || DEFAULT_REGION };
  const response = await call('/feeds', { method: 'POST', body: JSON.stringify(body) }, deps);
  const parsed = Feed.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) throw new FlowError('RSS_APP_UNAVAILABLE', 503);
  const feed = parsed.data;
  return {
    id: feed.id,
    title: feed.title?.trim() || undefined,
    site: feed.source_url ?? undefined,
    feedUrl: feed.rss_feed_url,
    entries: (feed.items ?? []).slice(0, 100).flatMap(entryOf),
  };
}

/** Frees the plan's slot when the desk removes the source. A feed already gone is not an error. */
export async function deleteRssAppFeed(id: string, deps: RssAppServices = services): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return;
  try {
    await call(`/feeds/${id}`, { method: 'DELETE' }, deps);
  } catch (error) {
    if (error instanceof FlowError && error.code === 'RSS_APP_REFUSED') return;
    throw error;
  }
}
