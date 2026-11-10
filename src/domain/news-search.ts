import { clippingBlocked, seafoodClippingQuery } from './news-clipping.ts';
import type { ClippingWindow } from './news-clipping.ts';
import { isPortalAddress } from './news-discovery.ts';
import { isNewsAddress } from './news-intake.ts';

/** A portal's persisted complementary collection. Limits include manual searches and retries. */
export type NewsSearchConfig = {
  portalUrl: string;
  sector: string;
  region: string;
  topics: string[];
  languages: ('pt' | 'en' | 'es')[];
  excludedDomains: string[];
  everyMinutes: 60 | 120 | 360;
  dailyLimit: number;
  enabled: boolean;
  windowHours?: ClippingWindow;
};
export type NewsSearchView = {
  configured: boolean;
  clipping?: boolean;
  revision: number;
  config?: NewsSearchConfig;
  state: 'idle' | 'queued' | 'running' | 'paused' | 'limited' | 'failed';
  usedToday: number;
  lastRunAt?: string;
  nextRunAt?: string;
  lastAdded: number;
  lastError?: string;
};
export type NewsSearchWrite = { revision: number; config: NewsSearchConfig };
export type NewsSearchClaim = {
  actor?:string|null;
  clipping?: boolean;
  fence: string; config: NewsSearchConfig; domains: string[]; queryIndex: number;
};

export function searchDomain(value: string): string | undefined {
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    return isNewsAddress(url.href) && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) && host.includes('.') ? host : undefined;
  } catch { return undefined; }
}

export function searchExcluded(url: string, domains: readonly string[]): boolean {
  return !isNewsAddress(url) || clippingBlocked(url) || isPortalAddress(url, domains.map(domain => `https://${domain}`));
}

export function newsSearchQuery(config: NewsSearchConfig, index: number, clipping = clippingBlocked(config.portalUrl)) {
  if (clipping) return seafoodClippingQuery(index);
  const combination = Math.floor(index / 2);
  const language = config.languages[combination % config.languages.length];
  const topic = config.topics[Math.floor(combination / config.languages.length) % config.topics.length];
  const news = { pt: 'notícias', en: 'news', es: 'noticias' }[language];
  return { query: [topic, config.sector, config.region, news].filter(Boolean).join(' ').slice(0, 380), language,
    mode: index % 2 ? 'news' as const : 'general' as const };
}
