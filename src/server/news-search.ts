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
  portalUrl: z.string().trim().max(2000).refine(isNewsAddress),
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
export async function readNewsSearch(): Promise<NewsSearchView> {
  const { domains: _domains, ...view } = await newsSearchSql<StoredView>('runtime', 'SELECT public.reporter_news_search_view() AS value');
  return { ...view, configured: tavilyConfigured() };
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
  const domains = [searchDomain(config.portalUrl)!];
  // Persist the actual redirect target too. Changing terms never needs to reread the client site.
  if (current.config?.portalUrl === config.portalUrl) domains.push(...current.domains ?? []);
  else {
    const page = await deps.fetch(config.portalUrl, { maxBytes: 512_000, accept: 'text/html' });
    const redirected = searchDomain(page.url);
    if (!redirected) throw new FlowError('NEWS_SEARCH_INVALID', 422);
    domains.push(redirected);
  }
  config.topics = [...new Set(config.topics)];
  config.languages = [...new Set(config.languages)];
  config.excludedDomains = [...new Set(config.excludedDomains.map(value => searchDomain(value)!))];
  // Retain client redirect identities, but allow editors to remove optional exclusions.
  const oldExcluded = current.config?.excludedDomains ?? [];
  const excluded = [...new Set([...domains.filter(domain => !oldExcluded.includes(domain)), ...config.excludedDomains, searchDomain(config.portalUrl)!])];
  const { domains: _domains, ...saved } = await deps.save(revision, config, excluded);
  return { ...saved, configured: deps.configured() };
}

export async function requestNewsSearch(): Promise<NewsSearchView> {
  await services.requireEdit();
  if (!tavilyConfigured()) throw new FlowError('TAVILY_KEY_MISSING', 503);
  const { domains: _domains, ...view } = await newsSearchSql<StoredView>('runtime', 'SELECT public.reporter_news_search_request() AS value');
  return { ...view, configured: true };
}
