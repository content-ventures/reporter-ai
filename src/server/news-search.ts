import 'server-only';
import { z } from 'zod';
import { isNewsAddress } from '../domain/news-intake.ts';
import { searchDomain, searchExcluded } from '../domain/news-search.ts';
import type { NewsSearchConfig, NewsSearchView } from '../domain/news-search.ts';
import { transaction } from './database.ts';
import { FlowError } from './errors.ts';
import { fetchText } from './news-fetch.ts';
import { tavilyConfigured } from './tavily.ts';

const configSchema = z.object({
  portalUrl: z.string().trim().max(2000).refine(value => isNewsAddress(value) && Boolean(searchDomain(value))),
  sector: z.string().trim().min(1).max(160), region: z.string().trim().max(100),
  topics: z.array(z.string().trim().min(1).max(160)).min(1).max(6),
  languages: z.array(z.enum(['pt', 'en', 'es'])).min(1).max(3),
  excludedDomains: z.array(z.string().trim().max(253).refine(value => Boolean(searchDomain(value)))).max(20),
  everyMinutes: z.union([z.literal(60), z.literal(120), z.literal(360)]),
  dailyLimit: z.number().int().min(1).max(48), enabled: z.boolean(),
}).strict();
export const searchWriteSchema = z.object({ revision: z.number().int().min(0), config: configSchema }).strict();

export async function newsSearchSql<T>(role: 'runtime' | 'worker', query: string, values: unknown[] = []): Promise<T> {
  try { return await transaction(role, async client => (await client.query(query, values)).rows[0]?.value as T); }
  catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (/^NEWS_SEARCH_[A-Z_]+$/.test(code)) throw new FlowError(code, code === 'NEWS_SEARCH_CONFLICT' ? 409 : 422);
    throw error;
  }
}
type StoredView = Omit<NewsSearchView, 'configured'> & { domains?: string[] };
function publicView(stored: StoredView, configured: boolean): NewsSearchView {
  const { revision, config, state, usedToday, lastRunAt, nextRunAt, lastAdded, lastError } = stored;
  return { configured, revision, config, state, usedToday, lastRunAt, nextRunAt, lastAdded, lastError };
}
export async function readNewsSearch(): Promise<NewsSearchView> {
  return publicView(await newsSearchSql<StoredView>('runtime', 'SELECT public.reporter_news_search_view() AS value'), tavilyConfigured());
}
export async function newsExcludedDomains(): Promise<string[]> {
  return (await newsSearchSql<StoredView>('runtime', 'SELECT public.reporter_news_search_view() AS value')).domains ?? [];
}
export async function requireExternalNews(url: string): Promise<void> {
  if (searchExcluded(url, await newsExcludedDomains())) throw new FlowError('NEWS_SEARCH_EXCLUDED', 422);
}

export type SearchSettingsServices = {
  requireEdit(): Promise<void>;
  read(): Promise<StoredView>;
  fetch: typeof fetchText;
  configured(): boolean;
  save(revision: number, config: NewsSearchConfig, domains: string[]): Promise<StoredView>;
};
const services: SearchSettingsServices = {
  requireEdit: () => newsSearchSql('runtime', 'SELECT public.reporter_news_require_edit() AS value'),
  read: () => newsSearchSql('runtime', 'SELECT public.reporter_news_search_view() AS value'),
  fetch: fetchText, configured: tavilyConfigured,
  save: (revision, config, domains) => newsSearchSql('runtime', 'SELECT public.reporter_news_search_save($1,$2,$3) AS value', [revision, JSON.stringify(config), domains]),
};

export async function saveNewsSearch(input: unknown, deps: SearchSettingsServices = services): Promise<NewsSearchView> {
  await deps.requireEdit();
  const parsed = searchWriteSchema.safeParse(input);
  if (!parsed.success) throw new FlowError('NEWS_SEARCH_INVALID', 422);
  const { revision, config } = parsed.data;
  if (config.enabled && !deps.configured()) throw new FlowError('TAVILY_KEY_MISSING', 503);
  const current = await deps.read();
  if (revision !== current.revision) throw new FlowError('NEWS_SEARCH_CONFLICT', 409);
  config.excludedDomains = [...new Set(config.excludedDomains.map(value => searchDomain(value)!))];
  const oldExcluded = current.config?.excludedDomains ?? [];
  const reuse = current.config?.portalUrl === config.portalUrl && oldExcluded.every(domain => config.excludedDomains.includes(domain));
  const domains = [searchDomain(config.portalUrl)!];
  // Removing optional exclusions revalidates redirects so a client alias cannot be unblocked.
  if (reuse) domains.push(...(current.domains ?? []).filter(domain => !oldExcluded.includes(domain)));
  else {
    const page = await deps.fetch(config.portalUrl, { maxBytes: 512_000, accept: 'text/html' });
    const redirected = searchDomain(page.url);
    if (!redirected) throw new FlowError('NEWS_SEARCH_INVALID', 422);
    domains.push(redirected);
  }
  config.topics = [...new Set(config.topics)];
  config.languages = [...new Set(config.languages)];
  const excluded = [...new Set([...domains, ...config.excludedDomains])];
  return publicView(await deps.save(revision, config, excluded), deps.configured());
}

export async function requestNewsSearch(): Promise<NewsSearchView> {
  await services.requireEdit();
  if (!tavilyConfigured()) throw new FlowError('TAVILY_KEY_MISSING', 503);
  return publicView(await newsSearchSql<StoredView>('runtime', 'SELECT public.reporter_news_search_request() AS value'), true);
}
