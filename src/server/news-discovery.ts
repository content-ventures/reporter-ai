import 'server-only';
import { DomUtils, parseDocument } from 'htmlparser2';
import { z } from 'zod';
import type { FactSource } from '../domain/fact-check.ts';
import { discoveryCandidates, discoveryQueries, NEWS_DISCOVERY_LIMITS } from '../domain/news-discovery.ts';
import type { NewsDiscoveryContext, NewsDiscoveryResult, NewsSourceSuggestion } from '../domain/news-discovery.ts';
import { canonicalUrl, cleanText, isNewsAddress, NEWS_LIMITS } from '../domain/news-intake.ts';
import { FlowError } from './errors.ts';
import { fetchText } from './news-fetch.ts';
import type { FetchedText } from './news-fetch.ts';
import { discoverFeeds, htmlText, parseFeed } from './news-parse.ts';
import type { ParsedFeed } from './news-parse.ts';
import { entriesFor, FEED_ACCEPT } from './news-reader.ts';
import { searchEvidence, tavilyConfigured } from './tavily';

export type NewsDiscoveryServices = {
  search: typeof searchEvidence;
  fetch: typeof fetchText;
  configured: () => boolean;
  now: () => number;
};
const services: NewsDiscoveryServices = { search: searchEvidence, fetch: fetchText, configured: tavilyConfigured, now: Date.now };
const inputSchema = z.object({
  portalUrl: z.string().trim().max(2000).refine(value => !value || isNewsAddress(value)).optional(),
  sector: z.string().trim().max(160).optional(),
  region: z.string().trim().max(100).optional(),
}).strict().refine(value => Boolean(value.portalUrl || value.sector));
const PAGE_ACCEPT = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5';

function refusal(code: string, reason: string, status = 422) {
  const error = new FlowError(code, status);
  error.reason = reason;
  return error;
}

/** DNS or a provider that ignores cancellation must not outlive the request's response budget. */
function bounded<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    void Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); })
      .then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Public metadata is context quoted from the portal, never a model-generated claim about it. */
function portalDescription(html: string, url: string): NonNullable<NewsDiscoveryContext['portal']> {
  const document = parseDocument(html);
  const meta = (names: string[]) => {
    const element = DomUtils.findOne(node => node.name === 'meta' && names.includes(
      (DomUtils.getAttributeValue(node, 'property') ?? DomUtils.getAttributeValue(node, 'name') ?? '').toLowerCase()), document.children);
    return element ? cleanText(htmlText(DomUtils.getAttributeValue(element, 'content'))) : '';
  };
  const titleElement = DomUtils.findOne(node => node.name === 'title', document.children);
  const title = (meta(['og:site_name']) || (titleElement && cleanText(DomUtils.textContent(titleElement))) || new URL(url).hostname).slice(0, 160);
  const description = meta(['description', 'og:description']).slice(0, 400);
  return { url, title, ...(description ? { description } : {}) };
}

function baseSuggestion(evidence: FactSource): NewsSourceSuggestion {
  const site = new URL(evidence.url).origin;
  return { id: canonicalUrl(site)!, name: new URL(site).hostname.replace(/^www\./, ''), site, status: 'no-feed',
    reason: `Encontrado na busca: ${evidence.excerpt.slice(0, 240)}`,
    evidence: { url: evidence.url, title: evidence.title, excerpt: evidence.excerpt }, sample: [], recentItems: 0 };
}

/** Some publishers expose RSS through a visible link rather than a head alternate. */
function announcedFeeds(html: string, base: string): string[] {
  const document = parseDocument(html);
  const anchors = DomUtils.findAll(node => node.name === 'a', document.children).flatMap(node => {
    const href = DomUtils.getAttributeValue(node, 'href');
    if (!href || !/(?:rss|atom|feed)/i.test(`${href} ${DomUtils.textContent(node)}`)) return [];
    try { return [new URL(href, base).toString()]; } catch { return []; }
  });
  return [...new Set([...discoverFeeds(html, base), ...anchors])]
    .filter(url => isNewsAddress(url) && !/comments|comentarios|comentários/i.test(url)).slice(0, 5);
}

/** A successful parse proves availability; only dates the feed supplied count as recent news. */
function verified(base: NewsSourceSuggestion, feed: ParsedFeed, url: string, now: number): NewsSourceSuggestion {
  const dated = feed.entries.filter(entry => {
    const date = entry.publishedAt ? Date.parse(entry.publishedAt) : NaN;
    return Number.isFinite(date) && date <= now && date >= now - NEWS_LIMITS.firstReadDays * 86_400_000;
  });
  const entries = entriesFor({ kind: 'rss', name: feed.title || base.name, firstRead: true }, dated, now);
  return { ...base, status: 'verified', feedUrl: url, name: cleanText(feed.title).slice(0, 120) || base.name,
    recentItems: entries.length, sample: entries.slice(0, NEWS_DISCOVERY_LIMITS.sampleItems)
      .map(entry => ({ title: entry.title, url: entry.url, publishedAt: entry.publishedAt })),
    ...(!entries.length ? { issue: 'O feed foi validado, mas não informou notícias dos últimos 7 dias.' } : {}) };
}

/** Conventional URLs are probes, never suggestions until their response parses as a real feed. */
async function verifyCandidate(evidence: FactSource, deps: NewsDiscoveryServices, parentSignal: AbortSignal, seed?: FetchedText): Promise<NewsSourceSuggestion> {
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(NEWS_DISCOVERY_LIMITS.siteTimeoutMs)]);
  const base = baseSuggestion(evidence), visited = new Set<string>();
  if (seed?.url === evidence.url) base.reason = `Portal informado: ${evidence.excerpt.slice(0, 240)}`;
  let reachable = false;
  let feedAttempts = 0;
  let origin = base.site;
  const read = async (url: string, feed = false) => {
    if (seed?.url === url) return seed;
    const readSignal = AbortSignal.any([signal, AbortSignal.timeout(NEWS_DISCOVERY_LIMITS.readTimeoutMs)]);
    return bounded(readSignal, () => deps.fetch(url, { maxBytes: feed ? NEWS_LIMITS.feedBytes : NEWS_LIMITS.pageBytes,
      accept: feed ? FEED_ACCEPT : PAGE_ACCEPT, signal: readSignal }));
  };
  const tryFeed = async (url: string) => {
    if (visited.has(url) || !isNewsAddress(url)) return undefined;
    visited.add(url);
    try {
      const fetched = await read(url, true);
      const feed = fetched.status === 200 ? parseFeed(fetched.text) : undefined;
      return feed && !/^(comments|comentários|comentarios)\b/i.test(feed.title ?? '') ? verified(base, feed, fetched.url, deps.now()) : undefined;
    } catch { return undefined; }
  };
  for (const address of [...new Set([evidence.url, base.site])]) {
    if (signal.aborted) break;
    try {
      const page = await read(address);
      if (page.status !== 200) continue;
      reachable = true;
      origin = new URL(page.url).origin;
      const direct = parseFeed(page.text);
      if (direct) return verified(base, direct, page.url, deps.now());
      for (const url of announcedFeeds(page.text, page.url)) {
        if (feedAttempts >= NEWS_DISCOVERY_LIMITS.feedsPerSite || visited.has(url)) continue;
        feedAttempts += 1;
        const found = await tryFeed(url);
        if (found) return found;
      }
    } catch { /* Keep the search evidence; a failed public read is never labelled verified. */ }
  }
  if (!signal.aborted) {
    const fallback = ['/feed/', '/rss'].slice(0, NEWS_DISCOVERY_LIMITS.fallbackFeeds).map(path => new URL(path, origin).toString());
    const found = (await Promise.all(fallback.map(tryFeed))).filter((item): item is NewsSourceSuggestion => Boolean(item));
    found.sort((a, b) => b.recentItems - a.recentItems);
    if (found[0]) return found[0];
  }
  return { ...base, status: reachable ? 'no-feed' : 'unavailable', issue: signal.aborted
    ? 'A verificação não terminou no prazo. Tente novamente.'
    : reachable ? 'Não encontramos um feed que pudesse ser validado neste site.' : 'Não foi possível ler o site para validar um feed.' };
}

/** Read-only discovery. The authenticated route checks permissions before invoking providers. */
export async function discoverNewsSources(value: unknown, deps: NewsDiscoveryServices = services, callerSignal?: AbortSignal): Promise<NewsDiscoveryResult> {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) throw refusal('NEWS_DISCOVERY_INPUT', 'Informe o endereço completo do portal ou o setor que deseja acompanhar.');
  if (!deps.configured()) throw refusal('TAVILY_KEY_MISSING', 'A busca na web não está configurada. Peça a um administrador para conectar o Tavily.', 503);
  const timeout = AbortSignal.timeout(NEWS_DISCOVERY_LIMITS.timeoutMs);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
  signal.throwIfAborted();
  const input = parsed.data;
  const context: NewsDiscoveryContext = { ...(input.sector ? { sector: cleanText(input.sector) } : {}), ...(input.region ? { region: cleanText(input.region) } : {}) };
  let portalPage: FetchedText | undefined;
  if (input.portalUrl) {
    try {
      const portal = await bounded(signal, () => deps.fetch(input.portalUrl!, { maxBytes: NEWS_LIMITS.pageBytes, accept: PAGE_ACCEPT, signal }));
      if (portal.status !== 200) throw new Error('PORTAL_UNREADABLE');
      portalPage = portal;
      context.portal = portalDescription(portal.text, portal.url);
    } catch {
      throw refusal('NEWS_DISCOVERY_PORTAL', 'Não foi possível ler o portal. Confira o endereço ou pesquise apenas pelo setor.');
    }
    if (!context.sector && !context.portal.description && (context.portal.title === new URL(context.portal.url).hostname
      || /^(home|início|inicio|bem-vindo|bem vindo)$/i.test(context.portal.title)))
      throw refusal('NEWS_DISCOVERY_CONTEXT', 'O portal não informa seu tema no título ou na descrição. Informe o setor para orientar a busca.');
  }
  const queries = discoveryQueries(context);
  let results: FactSource[];
  try { results = (await Promise.all(queries.map(query => bounded(signal, () => deps.search(query, signal))))).flat(); }
  catch (error) {
    if (signal.aborted) throw refusal('NEWS_DISCOVERY_TIMEOUT', 'A busca de fontes demorou mais que o esperado. Tente novamente.', 504);
    throw error;
  }
  const portal = context.portal;
  if (portal) results.unshift({ url: portal.url, title: portal.title, site: new URL(portal.url).hostname,
    excerpt: portal.description || portal.title });
  const candidates = discoveryCandidates(results, portal?.url), suggestions: NewsSourceSuggestion[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(NEWS_DISCOVERY_LIMITS.concurrency, candidates.length) }, async () => {
    while (next < candidates.length) {
      const index = next++;
      suggestions[index] = await verifyCandidate(candidates[index], deps, signal, portalPage);
    }
  }));
  callerSignal?.throwIfAborted();
  const order = { verified: 0, 'no-feed': 1, unavailable: 2 };
  const ownHost = portal && new URL(portal.url).hostname.toLowerCase().replace(/^www\./, '');
  const isOwnPortal = (suggestion: NewsSourceSuggestion) => Boolean(ownHost
    && new URL(suggestion.site).hostname.toLowerCase().replace(/^www\./, '') === ownHost);
  // Keep the search's relevance order among available feeds; publication volume is not relevance.
  suggestions.sort((a, b) => order[a.status] - order[b.status]
    || Number(isOwnPortal(b)) - Number(isOwnPortal(a))
    || Number(b.recentItems > 0) - Number(a.recentItems > 0));
  return { context, queries, suggestions, checkedAt: new Date(deps.now()).toISOString() };
}
