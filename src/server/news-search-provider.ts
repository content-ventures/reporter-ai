import 'server-only';
import { isIP } from 'node:net';
import { z } from 'zod';
import { normalizeEntry, NEWS_LIMITS } from '../domain/news-intake.ts';
import type { NormalizedNews } from '../domain/news-intake.ts';
import { newsSearchQuery, searchExcluded } from '../domain/news-search.ts';
import { isNewsSearchCandidate } from '../domain/news-search-candidate.ts';
import type { NewsSearchClaim } from '../domain/news-search.ts';
import { FlowError } from './errors.ts';
import { privateAddress } from './public-address.ts';

export type SearchNewsEntry = NormalizedNews & { contentKind: 'article' | 'search' };
const resultSchema = z.object({ url: z.string(), title: z.string().nullish(), content: z.string().nullish(),
  score: z.number().optional(),
  raw_content: z.string().nullish(), published_date: z.string().nullish(),
  images: z.array(z.union([z.string(), z.object({ url: z.string() }).passthrough()])).optional() }).passthrough();
const searchSchema = z.object({ results: z.array(resultSchema).max(100) }).passthrough();
const extractSchema = z.object({ results: z.array(z.object({ url: z.string(), raw_content: z.string(),
  images: z.array(z.string()).optional() }).passthrough()), failed_results: z.array(z.unknown()).optional() }).passthrough();
const SOCIAL = ['instagram.com', 'facebook.com', 'tiktok.com', 'youtube.com', 'x.com', 'twitter.com', 'linkedin.com'];
type Services = { request: typeof fetch; key(): string | undefined; now(): number; known?(urls: string[]): Promise<string[]> };
const services: Services = { request: fetch, key: () => process.env.TAVILY_API_KEY?.trim(), now: Date.now };

async function call(path: 'search' | 'extract', body: object, signal: AbortSignal, deps: Services) {
  const key = deps.key();
  if (!key) throw new FlowError('TAVILY_KEY_MISSING', 503);
  let response: Response;
  try {
    response = await deps.request(`https://api.tavily.com/${path}`, { method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]) });
  } catch { throw new FlowError('TAVILY_UNAVAILABLE', 503, true, 30); }
  if (!response.ok) throw new FlowError(response.status === 401 || response.status === 403 ? 'TAVILY_AUTH_INVALID'
    : response.status === 429 ? 'TAVILY_RATE_LIMIT' : [402, 432, 433].includes(response.status) ? 'TAVILY_QUOTA_EXHAUSTED' : 'TAVILY_REQUEST_FAILED',
    502, response.status === 429 || response.status >= 500, 30);
  // Bound untrusted provider responses as well as the outgoing search size.
  const reader = response.body?.getReader();
  if (!reader) throw new FlowError('TAVILY_INVALID_RESPONSE', 502);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 3 * 1024 * 1024) throw new FlowError('TAVILY_INVALID_RESPONSE', 502);
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
    catch { throw new FlowError('TAVILY_INVALID_RESPONSE', 502); }
  } finally { await reader.cancel().catch(() => {}); }
}

/** Only dated recent URLs enter the radar. The provider's date is explicitly an estimate. */
export async function collectSearchNews(claim: NewsSearchClaim, signal: AbortSignal, deps: Services = services): Promise<{ items: SearchNewsEntry[]; query: string }> {
  const { query, language, mode } = newsSearchQuery(claim.config, claim.queryIndex);
  const parsed = searchSchema.safeParse(await call('search', { query, language,
    topic: mode,
    search_depth: 'basic', time_range: 'week', include_published_date: true, filter_by_published_date: true,
    include_answer: false, include_raw_content: 'text', include_images: true, max_results: 10,
    exclude_domains: [...new Set([...claim.domains, ...SOCIAL])], include_usage: true,
  }, signal, deps));
  if (!parsed.success) throw new FlowError('TAVILY_INVALID_RESPONSE', 502);
  const seen = new Set<string>();
  const external = parsed.data.results.filter(result => {
    const at = Date.parse(result.published_date ?? '');
    if (searchExcluded(result.url, [...claim.domains, ...SOCIAL]) || !Number.isFinite(at) || at > deps.now() || at < deps.now() - 7 * 86_400_000 || seen.has(result.url)
      || !isNewsSearchCandidate(claim.config, result)) return false;
    const host = new URL(result.url).hostname.replace(/^\[|\]$/g, '');
    if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost') || isIP(host) && privateAddress(host)) return false;
    seen.add(result.url); return true;
  }).slice(0, 10);
  const known = new Set(await deps.known?.(external.map(item => item.url)) ?? []);
  const candidates = external.filter(item => !known.has(item.url));
  const full = (text?: string | null) => Boolean(text && text.trim().length >= 300);
  const missing = candidates.filter(item => !full(item.raw_content) || !item.images?.length).slice(0, 5);
  let extracted: z.infer<typeof extractSchema>['results'] = [];
  if (missing.length) {
    try {
      const result = extractSchema.safeParse(await call('extract', { urls: missing.map(item => item.url),
        extract_depth: 'basic', format: 'text', include_images: true, timeout: 20, include_usage: true }, signal, deps));
      if (result.success) extracted = result.data.results;
    } catch { signal.throwIfAborted(); /* Search snippets remain useful when extraction fails. */ }
  }
  const items = candidates.flatMap(result => {
    const page = extracted.find(item => item.url === result.url);
    const text = page?.raw_content || result.raw_content || result.content || '';
    const paragraphs = text.slice(0, NEWS_LIMITS.bodyChars).split(/\n\s*\n|\n/).flatMap(part => part.match(/[\s\S]{1,5000}/g) ?? []);
    // Only images associated with this URL. Query-wide image search is not article photography.
    const images = page?.images?.length ? page.images : result.images?.map(image => typeof image === 'string' ? image : image.url);
    const image = images?.find(url => !/favicon|logo|avatar/i.test(url) && !searchExcluded(url, claim.domains));
    const item = normalizeEntry({ url: result.url, title: result.title ?? '', paragraphs,
      publishedAt: result.published_date!, image }, { now: deps.now() });
    return item ? [{ ...item, contentKind: full(page?.raw_content || result.raw_content) ? 'article' as const : 'search' as const }] : [];
  });
  return { items, query };
}
