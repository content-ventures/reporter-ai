import 'server-only';
import type { PoolClient } from 'pg';
import { NEWS_LIMITS, normalizeEntries } from '../domain/news-intake.ts';
import type { NormalizedNews, RawNewsEntry } from '../domain/news-intake.ts';
import { transaction } from './database.ts';
import { FlowError, logEvent, safeCode } from './errors.ts';
import { fetchText } from './news-fetch.ts';
import type { FetchedText, FetchOptions } from './news-fetch.ts';
import { parseFeed } from './news-parse.ts';

export const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5';

/** A source leased for one read (`reporter_news_claim`). */
export type NewsClaim = {
  id: string;
  kind: 'rss' | 'google-alerts' | 'rss-app';
  name: string;
  url: string;
  keyword?: string;
  etag?: string;
  lastModified?: string;
  firstRead: boolean;
};

export type ReadResult = { inserted: number; grouped: number };

type Role = 'runtime' | 'worker';

async function call<T>(role: Role, sql: string, values: unknown[]): Promise<T> {
  return transaction(role, async (client: PoolClient) => (await client.query(sql, values)).rows[0]?.value as T);
}

export function claimSource(role: Role, owner: string, sourceId?: string): Promise<NewsClaim | null> {
  return call(role, 'SELECT public.reporter_news_claim($1,$2) AS value', [owner, sourceId ?? null]);
}

/** Feeds of one outlet carry its name; alerts and keyword feeds gather many outlets. */
export function entriesFor(claim: Pick<NewsClaim, 'kind' | 'name' | 'keyword' | 'firstRead'>, entries: readonly RawNewsEntry[], now = Date.now()): NormalizedNews[] {
  const aggregator = claim.kind === 'google-alerts' || Boolean(claim.keyword);
  return normalizeEntries(entries, {
    now,
    outlet: aggregator ? undefined : claim.name,
    since: claim.firstRead ? now - NEWS_LIMITS.firstReadDays * 86_400_000 : undefined,
  });
}

export function ingest(role: Role, claim: Pick<NewsClaim, 'id'>, owner: string, items: readonly NormalizedNews[], validators: { etag?: string; lastModified?: string }): Promise<ReadResult> {
  return call(role, 'SELECT public.reporter_news_ingest($1,$2,$3,$4,$5) AS value',
    [claim.id, owner, JSON.stringify(items), validators.etag ?? null, validators.lastModified ?? null]);
}

export async function markFailed(role: Role, claim: Pick<NewsClaim, 'id'>, owner: string, code: string): Promise<void> {
  await call(role, 'SELECT public.reporter_news_failed($1,$2,$3) AS value', [claim.id, owner, code]);
}

export type ReadServices = { fetch: (url: string, options: FetchOptions) => Promise<FetchedText>; now: () => number };
const services: ReadServices = { fetch: (url, options) => fetchText(url, options), now: Date.now };

/**
 * One read of a leased source: fetch with the cache validators, parse, normalize, store. A failure
 * is kept on the source as a code (three in a row show "Com falha") and rethrown to the caller.
 */
export async function readSource(role: Role, claim: NewsClaim, owner: string, deps: ReadServices = services): Promise<ReadResult> {
  try {
    const fetched = await deps.fetch(claim.url, { maxBytes: NEWS_LIMITS.feedBytes, accept: FEED_ACCEPT, etag: claim.etag, lastModified: claim.lastModified });
    if (fetched.status === 304) return await ingest(role, claim, owner, [], { etag: claim.etag, lastModified: claim.lastModified });
    const feed = parseFeed(fetched.text);
    if (!feed) throw new FlowError('NEWS_FEED_INVALID', 422);
    return await ingest(role, claim, owner, entriesFor(claim, feed.entries, deps.now()), fetched);
  } catch (error) {
    const code = error instanceof FlowError ? error.code : safeCode(error);
    // A lost lease (40001) means another read already finished: nothing to record.
    if (code !== '40001') await markFailed(role, claim, owner, code).catch(() => {});
    throw error;
  }
}

/** The worker's job: one due source per call. `false` when none is due. */
export async function runNewsSource(owner: string, signal: AbortSignal, deps: ReadServices = services): Promise<boolean> {
  if (signal.aborted) return false;
  const claim = await claimSource('worker', owner);
  if (!claim) return false;
  try {
    await readSource('worker', claim, owner, deps);
  } catch (error) {
    logEvent('worker', 'news_read_failed', { error_code: error instanceof FlowError ? error.code : safeCode(error) });
  }
  return true;
}
