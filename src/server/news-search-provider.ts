import 'server-only';
import { isIP } from 'node:net';
import { z } from 'zod';
import { CLIPPING_BLOCKED_DOMAIN, clippingBlocked, clippingDateMatches, clippingExcludedText, clippingSegment } from '../domain/news-clipping.ts';
import { CLIPPING_PRIORITY_DOMAINS, clippingNewsDomains } from '../domain/news-clipping-sources.ts';
import { normalizeEntry, NEWS_LIMITS, unwrapLink } from '../domain/news-intake.ts';
import type { NormalizedNews } from '../domain/news-intake.ts';
import { newsSearchQuery, searchExcluded } from '../domain/news-search.ts';
import { discoveryAddress, isPortalAddress } from '../domain/news-discovery.ts';
import { isNewsSearchCandidate } from '../domain/news-search-candidate.ts';
import type { NewsSearchClaim } from '../domain/news-search.ts';
import { FlowError } from './errors.ts';
import { fetchText } from './news-fetch.ts';
import { parseArticlePage } from './news-parse.ts';
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
type Services = { request: typeof fetch; key(): string | undefined; now(): number; known?(urls: string[]): Promise<string[]>; read?: typeof fetchText };
const services: Services = { request: fetch, key: () => process.env.TAVILY_API_KEY?.trim(), now: Date.now, read: fetchText };

function relevantSummary(result: z.infer<typeof resultSchema>) {
  return (result.score ?? 1) >= 0.5 && Boolean(clippingSegment(result.title ?? '', result.content ?? ''));
}

/** Keep the article when extraction also includes the publisher's menus and related links. */
function articleParagraphs(text: string, title: string) {
  const lines = text.split(/\n\s*\n|\n/).map(line => line.trim()).filter(Boolean);
  const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const headline = normalize(title.split(/\s+[|—–-]\s+/)[0]);
  const heading = headline.length >= 20 ? lines.findIndex(line => normalize(line) === headline) : -1;
  const article = heading >= 0 ? lines.slice(heading + 1) : lines;
  const related = article.findIndex((line, index) => index > 3 && /^(related (articles|news|stories)|most popular|read more|not[ií]cias relacionadas|leia tamb[eé]m|m[aá]s noticias)\s*:?$/i.test(line));
  return (related >= 0 ? article.slice(0, related) : article)
    .filter(line => !/^(home|menu|subscribe|sign in|login|contact us|advertising|inicio|assine|entrar|publicidade)$/i.test(line))
    .join('\n').slice(0, NEWS_LIMITS.bodyChars).split('\n').flatMap(part => part.match(/[\s\S]{1,5000}/g) ?? []);
}

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
  const clipping = claim.clipping ?? clippingBlocked(claim.config.portalUrl);
  const plan = newsSearchQuery(claim.config, claim.queryIndex, clipping);
  const { query, language, mode } = plan;
  const hours = claim.config.windowHours ?? (clipping ? 24 : 168);
  // Pair open-web discovery with a focused pass through the newsroom's sources.
  const priorityDomains = 'segment' in plan && plan.segment ? clippingNewsDomains(plan.segment, language) : undefined;
  const prioritySites = priorityDomains?.map(domain => `https://${domain}`) ?? [];
  const timeRange = hours === 24 && !clipping ? 'day' : hours <= 168 ? 'week' : hours <= 720 ? 'month' : 'year';
  const excluded = [...new Set([...claim.domains, ...SOCIAL, CLIPPING_BLOCKED_DOMAIN])];
  const parsed = searchSchema.safeParse(await call('search', { query, language,
    topic: priorityDomains ? 'general' : mode,
    search_depth: 'basic', time_range: timeRange, include_published_date: true, filter_by_published_date: !clipping,
    include_answer: false, include_raw_content: clipping ? false : 'text', include_images: !clipping, max_results: priorityDomains ? 12 : 10,
    exclude_domains: excluded, include_usage: true,
    ...(clipping ? { include_domains: priorityDomains ?? CLIPPING_PRIORITY_DOMAINS,
      include_domains_mode: priorityDomains ? 'restrict' : 'prefer', filter_by_language: !priorityDomains } : {}),
  }, signal, deps));
  if (!parsed.success) throw new FlowError('TAVILY_INVALID_RESPONSE', 502);
  const seen = new Set<string>();
  const now = deps.now();
  const external = parsed.data.results.map(result => ({ ...result, url: unwrapLink(result.url) })).filter(result => {
    if (searchExcluded(result.url, excluded) || seen.has(result.url)) return false;
    if ((!clipping || result.published_date) && !clippingDateMatches(result.published_date ?? '', now, hours)) return false;
    if (clipping) {
      const title = result.title ?? '', summary = result.content ?? '';
      if (!discoveryAddress(result.url) || new URL(result.url).pathname === '/' || clippingExcludedText(title, summary)) return false;
      // A priority publisher's article can be relevant even when the search preview is generic.
      if (!relevantSummary(result) && !isPortalAddress(result.url, prioritySites)) return false;
    } else if (!isNewsSearchCandidate(claim.config, result)) return false;
    const host = new URL(result.url).hostname.replace(/^\[|\]$/g, '');
    if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost') || isIP(host) && privateAddress(host)) return false;
    seen.add(result.url); return true;
  }).slice(0, 10);
  const known = new Set(await deps.known?.(external.map(item => item.url)) ?? []);
  const candidates = external.filter(item => !known.has(item.url));
  if (clipping) {
    // Keep the bounded publisher reads available for stories already dated within the window.
    const publisherReads = new Set([...candidates]
      .sort((a, b) => Number(Boolean(b.published_date)) - Number(Boolean(a.published_date)))
      .slice(0, 5).map(result => result.url));
    // The provider's search range is broad. Enforce the exact window using the publisher's date when available.
    const items = await Promise.all(candidates.map(async (result): Promise<SearchNewsEntry | undefined> => {
      // An uncertain search preview cannot establish the topic or date by itself.
      const needsConfirmation = !relevantSummary(result);
      if (publisherReads.has(result.url) && deps.read) {
        try {
          const page = await deps.read(result.url, { accept: 'text/html', maxBytes: NEWS_LIMITS.pageBytes, clippingIntake: true, signal });
          if (searchExcluded(page.url, excluded)) return undefined;
          const article = page.status === 200 ? parseArticlePage(page.text, page.url) : undefined;
          if (article) {
            if (needsConfirmation && (!article.publishedAt || article.contentKind === 'search')) return undefined;
            const publishedAt = article.publishedAt ?? result.published_date ?? '';
            if (!clippingDateMatches(publishedAt, now, hours)) return undefined;
            const item = normalizeEntry({ ...article, publishedAt }, { now, clipping: true });
            return item ? { ...item, contentKind: article.contentKind ?? 'article' } : undefined;
          }
        } catch (error) {
          signal.throwIfAborted();
          if (error instanceof FlowError && error.code === 'NEWS_SEARCH_EXCLUDED') return undefined;
        }
      }
      if (needsConfirmation || !result.published_date) return undefined;
      const item = normalizeEntry({ url: result.url, title: result.title ?? '',
        paragraphs: result.content ? [result.content] : [], publishedAt: result.published_date, contentKind: 'search' }, { now, clipping: true });
      return item && { ...item, contentKind: 'search' };
    }));
    return { items: items.filter((item): item is SearchNewsEntry => Boolean(item)), query };
  }
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
    const paragraphs = articleParagraphs(text, result.title ?? '');
    // Only images associated with this URL. Query-wide image search is not article photography.
    const images = page?.images?.length ? page.images : result.images?.map(image => typeof image === 'string' ? image : image.url);
    const image = images?.find(url => !/favicon|logo|avatar/i.test(url) && !searchExcluded(url, claim.domains));
    const item = normalizeEntry({ url: result.url, title: result.title ?? '', paragraphs,
      publishedAt: result.published_date!, image }, { now: deps.now() });
    return item ? [{ ...item, contentKind: full(page?.raw_content || result.raw_content) ? 'article' as const : 'search' as const }] : [];
  });
  return { items, query };
}
