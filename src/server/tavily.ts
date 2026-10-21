import 'server-only';
import { z } from 'zod';
import { siteOf, type FactSource } from '../domain/fact-check.ts';
import { FlowError } from './errors';

/**
 * Web evidence for the fact check (Tavily Search). Calibrated on 2026-10-20 with real seafood
 * claims: the basic depth (1 credit, ~2 s) finds the sector's sources (Embrapa, IBGE, BNB,
 * Seafood Brasil, Valor); social networks only echo claims, so they are excluded.
 */
const ENDPOINT = 'https://api.tavily.com/search';
const SOCIAL = ['instagram.com', 'facebook.com', 'tiktok.com', 'youtube.com', 'x.com', 'twitter.com', 'linkedin.com', 'kwai.com'];
export const SEARCH_RESULTS = 5;

const response = z.object({ request_id: z.string().max(200).nullish(), usage: z.object({ credits: z.number().finite().nonnegative().optional() }).nullish(), results: z.array(z.object({
  url: z.string(), title: z.string().nullish(), content: z.string().nullish(), published_date: z.string().nullish(),
}).passthrough()) }).passthrough();

export function tavilyConfigured() {
  return Boolean(process.env.TAVILY_API_KEY?.trim());
}

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '…' : flat;
};

/** The day of a published date when Tavily gives one ("2026-03-12"). */
function dayOf(value: string | null | undefined): string | undefined {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : undefined;
}

export type TavilySearchOptions = { maxResults?: number; timeoutMs?: number; excludeDomains?: readonly string[]; maxExcerptCharacters?: number };
export type TavilySearchResult = { sources: FactSource[]; requestId: string | null; credits: number | null };

/** Search returns retained excerpts and measured provider metadata, never the generated answer. */
export async function searchWebEvidence(query: string, signal: AbortSignal, options: TavilySearchOptions = {}): Promise<TavilySearchResult> {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) throw new FlowError('TAVILY_KEY_MISSING', 503);
  if (signal.aborted) throw new FlowError('JOB_INTERRUPTED', 409);
  const maxResults = Math.min(5, Math.max(1, Math.floor(options.maxResults ?? SEARCH_RESULTS)));
  const timeoutMs = Math.min(30000, Math.max(5000, Math.floor(options.timeoutMs ?? 20000)));
  const excludeDomains = [...new Set(options.excludeDomains ?? SOCIAL)].slice(0, 150);
  let reply: Response;
  try {
    reply = await fetch(ENDPOINT, { method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: clip(query, 380), search_depth: 'basic', max_results: maxResults,
        topic: 'general', country: 'brazil', include_published_date: true, exclude_domains: excludeDomains,
        auto_parameters: false, include_answer: false, include_raw_content: false, include_images: false, include_usage: true }) });
  } catch {
    throw new FlowError(signal.aborted ? 'JOB_INTERRUPTED' : 'TAVILY_UNAVAILABLE', 503, true, 10);
  }
  if (!reply.ok) {
    const code = reply.status === 401 || reply.status === 403 ? 'TAVILY_AUTH_INVALID'
      : reply.status === 429 ? 'TAVILY_RATE_LIMIT'
      : reply.status === 402 || reply.status === 432 || reply.status === 433 ? 'TAVILY_QUOTA_EXHAUSTED' : 'TAVILY_REQUEST_FAILED';
    throw new FlowError(code, 502, code === 'TAVILY_RATE_LIMIT' || reply.status >= 500, 30);
  }
  const parsed = response.safeParse(await reply.json().catch(() => null));
  if (!parsed.success) throw new FlowError('TAVILY_INVALID_RESPONSE', 502, true, 10);
  if (signal.aborted) throw new FlowError('JOB_INTERRUPTED', 409);
  const sources = parsed.data.results.slice(0, maxResults).flatMap(result => {
    const site = siteOf(result.url), excerpt = clip(result.content ?? '', Math.min(1200, Math.max(200, options.maxExcerptCharacters ?? 600)));
    if (!site || !/^https:\/\//.test(result.url) || !excerpt) return [];
    const url = new URL(result.url);
    if (url.username || url.password || excludeDomains.some(domain => site === domain || site.endsWith('.' + domain))) return [];
    const publishedOn = dayOf(result.published_date);
    return [{ url: result.url, title: clip(result.title || site, 200), site, excerpt, ...(publishedOn ? { publishedOn } : {}) }];
  });
  return { sources, requestId: parsed.data.request_id ?? null, credits: parsed.data.usage?.credits ?? null };
}

/** Preserve the existing citation fact-check contract. */
export async function searchEvidence(query: string, signal: AbortSignal): Promise<FactSource[]> {
  return (await searchWebEvidence(query, signal)).sources;
}
