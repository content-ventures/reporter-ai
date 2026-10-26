import 'server-only';
import { logWorkerEvent as logEvent } from './worker-context.ts';
import { withWorkspaceWork } from './worker-dispatch.ts';
import { bindAutomatedJob } from './worker-job-context.ts';
import type { NewsSearchClaim } from '../domain/news-search.ts';
import { newsSearchQuery } from '../domain/news-search.ts';
import { FlowError, safeCode } from './errors.ts';
import { newsSearchSql } from './news-search.ts';
import { collectSearchNews } from './news-search-provider.ts';
import type { SearchNewsEntry } from './news-search-provider.ts';
import { tavilyConfigured } from './tavily.ts';

export type NewsSearchWorkerServices = {
  configured(): boolean;
  claim(owner: string): Promise<NewsSearchClaim | null>;
  collect: typeof collectSearchNews;
  finish(owner: string, fence: string, items: SearchNewsEntry[], query: string, error?: string): Promise<boolean>;
  now(): number;
};
const services: NewsSearchWorkerServices = {
  configured: tavilyConfigured,
  claim: owner => newsSearchSql('worker', 'SELECT public.reporter_news_search_claim($1) AS value', [owner]),
  collect: (claim, signal) => collectSearchNews(claim, signal, {
    request: fetch, key: () => process.env.TAVILY_API_KEY?.trim(), now: Date.now,
    known: urls => newsSearchSql('worker', 'SELECT public.reporter_news_search_known($1) AS value', [urls]),
  }),
  finish: (owner, fence, items, query, error) => newsSearchSql('worker', 'SELECT public.reporter_news_search_finish($1,$2,$3,$4,$5) AS value',
    [owner, fence, JSON.stringify(items), query, error ?? null]),
  now: Date.now,
};

/** One reserved search per job. A restart cannot reset the portal's daily budget. */
export async function runNewsSearchJob(owner: string, signal: AbortSignal, deadline?: number, deps: NewsSearchWorkerServices = services): Promise<boolean | 'yield'> {
  if (deps !== services) return runScoped(owner,signal,deadline,deps);
  return withWorkspaceWork('search',owner,signal, scoped => runScoped(owner,scoped,deadline,deps));
}

async function runScoped(owner: string, signal: AbortSignal, deadline?: number, deps: NewsSearchWorkerServices = services): Promise<boolean | 'yield'> {
  if (signal.aborted) return false;
  if (deadline !== undefined && deps.now() + 95_000 > deadline) return 'yield';
  const claim = await deps.claim(owner);
  if (!claim) return false;
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(90_000)]);
  try {
    if(deps===services)bindAutomatedJob(claim.actor,'search',claim.fence);
    if (!deps.configured()) throw new FlowError('TAVILY_KEY_MISSING', 503);
    const result = await deps.collect(claim, bounded);
    bounded.throwIfAborted();
    await deps.finish(owner, claim.fence, result.items, result.query);
  } catch (error) {
    const code = bounded.aborted ? 'NEWS_SEARCH_INTERRUPTED' : safeCode(error);
    await deps.finish(owner, claim.fence, [], newsSearchQuery(claim.config, claim.queryIndex).query, code);
    logEvent('worker', 'news_search_failed', { error_code: code });
  }
  return true;
}
