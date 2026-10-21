import type { FactSource } from './fact-check.ts';
import { canonicalUrl, cleanText, isNewsAddress } from './news-intake.ts';

/** A portal supplies its public description; a sector is the person's explicit search context. */
export type NewsDiscoveryInput = { portalUrl?: string; sector?: string; region?: string };
export type NewsDiscoveryContext = {
  portal?: { url: string; title: string; description?: string };
  sector?: string;
  region?: string;
};
export type NewsSourceSuggestion = {
  id: string;
  name: string;
  site: string;
  status: 'verified' | 'no-feed' | 'unavailable';
  /** Present only after fetching and parsing the feed. */
  feedUrl?: string;
  reason: string;
  evidence: { url: string; title: string; excerpt: string };
  sample: { title: string; url: string; publishedAt?: string }[];
  /** Dated entries from the same seven-day window used by the first collection. */
  recentItems: number;
  issue?: string;
};
export type NewsDiscoveryResult = {
  context: NewsDiscoveryContext;
  queries: string[];
  suggestions: NewsSourceSuggestion[];
  checkedAt: string;
};

export const NEWS_DISCOVERY_LIMITS = {
  timeoutMs: 35_000, siteTimeoutMs: 12_000, readTimeoutMs: 4_500,
  candidates: 8, concurrency: 4, feedsPerSite: 2, fallbackFeeds: 2, sampleItems: 3,
} as const;

/** Uses only the entered sector or the site's own words, without inventing an editorial map. */
export function discoveryQueries(context: NewsDiscoveryContext): string[] {
  const topic = cleanText(context.sector || context.portal?.description || context.portal?.title).slice(0, 160);
  const region = cleanText(context.region).slice(0, 70);
  return [
    `${topic} ${region} portal revista especializada notícias`.replace(/\s+/g, ' ').trim(),
    `${topic} ${region} últimas notícias`.replace(/\s+/g, ' ').trim(),
  ];
}

/** News publishers and institutional news are useful; academic catalogues and PDFs are not feeds. */
export function discoveryAddress(value: string): boolean {
  if (!isNewsAddress(value)) return false;
  const url = new URL(value);
  return !/\.(pdf|docx?|xlsx?|pptx?|zip)$/i.test(url.pathname)
    && !/(^|\.)(repositorio|repository|periodicos|dspace|ojs)\./i.test(url.hostname)
    && !/\/(repositorio|repository|periodicos|bitstream|handle|jspui|ojs)(\/|$)/i.test(url.pathname)
    && !/\/article\/(view|download)\//i.test(url.pathname);
}

/** One verifiable result per site. The portal itself remains useful when explicitly supplied. */
export function discoveryCandidates(results: readonly FactSource[], portalUrl?: string): FactSource[] {
  const host = (url: string) => new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  const ownHost = portalUrl && isNewsAddress(portalUrl) ? host(portalUrl) : undefined;
  const seen = new Set<string>();
  const candidates = results.filter(result => {
    if (!discoveryAddress(result.url) || !canonicalUrl(result.url)) return false;
    const catalogue = /reposit[oó]rio (digital|institucional|de materiais)|biblioteca digital|peri[oó]dicos (cient[ií]ficos|acad[eê]micos)|teses e disserta[cç][oõ]es|open journal systems|\bdspace\b/i
      .test(`${result.title} ${result.excerpt}`);
    if (catalogue && !/\/(noticias?|news|imprensa)\b/i.test(new URL(result.url).pathname)) return false;
    const key = host(result.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // A supplied portal is a real starting point; prefer its own entry over unrelated results.
  candidates.sort((a, b) => Number(host(b.url) === ownHost) - Number(host(a.url) === ownHost));
  return candidates.slice(0, NEWS_DISCOVERY_LIMITS.candidates);
}
