import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NewsSearchClaim, NewsSearchConfig } from '../src/domain/news-search.ts';
import { collectSearchNews } from '../src/server/news-search-provider.ts';
import { saveNewsSearch } from '../src/server/news-search.ts';
import type { SearchSettingsServices } from '../src/server/news-search.ts';
import { runNewsSearchJob } from '../src/server/news-search-worker.ts';
import type { NewsSearchWorkerServices } from '../src/server/news-search-worker.ts';

const now = Date.parse('2026-10-21T16:00:00Z');
const config: NewsSearchConfig = { portalUrl: 'https://client.example', sector: 'aquicultura', region: 'Brasil',
  topics: ['tilápia'], languages: ['pt', 'en'], excludedDomains: [], everyMinutes: 60, dailyLimit: 12, enabled: true };
const claim: NewsSearchClaim = { config, domains: ['client.example'], fence: '10000000-0000-4000-8000-000000000001', queryIndex: 0 };
const article = (url: string, date: string | null = '2026-10-21T14:00:00Z') => ({ url, title: 'Fish production rises',
  content: 'A reported increase in production.', published_date: date });

test('search imports recent external publications, completes partial results and never uses query-level images', async () => {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const result = await collectSearchNews(claim, new AbortController().signal, { now: () => now, key: () => 'fixture-key', request: async (url, init) => {
    const body = JSON.parse(init?.body as string); requests.push({ url: String(url), body });
    assert.match(String(new Headers(init?.headers).get('authorization')), /^Bearer /);
    return Response.json(String(url).endsWith('/search') ? { images: [{ url: 'https://unrelated.example/photo.jpg' }], results: [
      article('https://publisher.example/a'), article('https://publisher.example/a'), article('https://another.example/b'),
      article('https://client.example/a'), article('https://sub.client.example/a'), article('https://old.example/a', '2020-01-01'),
      article('https://future.example/a', '2027-01-01'), article('https://undated.example/a', null),
    ] } : { results: [{ url: 'https://publisher.example/a', raw_content: 'Actual page paragraph. '.repeat(30), images: ['https://publisher.example/logo.png', 'https://publisher.example/fish.jpg'] }],
      failed_results: [{ url: 'https://another.example/b', error: 'Blocked' }] });
  } });
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].contentKind, 'article');
  assert.equal(result.items[0].image, 'https://publisher.example/fish.jpg');
  assert.equal(result.items[0].outlet, 'publisher.example');
  assert.equal(result.items[1].contentKind, 'search');
  assert.equal(result.items[1].image, undefined);
  assert.equal(requests[0].body.filter_by_published_date, true);
  assert.equal(requests[0].body.include_answer, false);
  assert.ok((requests[0].body.exclude_domains as string[]).includes('client.example'));
  assert.deepEqual(requests[1].body.urls, ['https://publisher.example/a', 'https://another.example/b']);
});

test('complete search content needs no extraction and extraction failure preserves the original snippet', async () => {
  for (const complete of [true, false]) {
    let calls = 0;
    const result = await collectSearchNews(claim, new AbortController().signal, { now: () => now, key: () => 'fixture', request: async () => {
      calls++;
      return calls === 1 ? Response.json({ results: [{ ...article('https://publisher.example/a'), raw_content: complete ? 'Page content. '.repeat(60) : null,
        images: complete ? [{ url: 'https://publisher.example/fish.jpg' }] : [] }] })
        : new Response('', { status: 503 });
    } });
    assert.equal(calls, complete ? 1 : 2);
    assert.equal(result.items[0].contentKind, complete ? 'article' : 'search');
  }
});

test('provider refusals and malformed results do not become news', async () => {
  for (const [status, code] of [[401, 'TAVILY_AUTH_INVALID'], [429, 'TAVILY_RATE_LIMIT'], [432, 'TAVILY_QUOTA_EXHAUSTED']] as const) {
    await assert.rejects(collectSearchNews(claim, new AbortController().signal, { now: () => now, key: () => 'fixture',
      request: async () => new Response('', { status }) }), { code });
  }
  await assert.rejects(collectSearchNews(claim, new AbortController().signal, { now: () => now, key: () => 'fixture',
    request: async () => Response.json({ answer: 'An AI response is not a publication.' }) }), { code: 'TAVILY_INVALID_RESPONSE' });
});

test('dated irrelevant results are rejected before spending extraction credits', async () => {
  let calls = 0;
  const result = await collectSearchNews(claim, new AbortController().signal, { now: () => now, key: () => 'fixture', request: async () => {
    calls++;
    return Response.json({ results: [
      { ...article('https://publisher.example/annual-report.pdf'), title: 'Fish annual report' },
      { ...article('https://publisher.example/'), title: 'Fish news homepage' },
      { ...article('https://publisher.example/speech'), title: 'Presidential state of the nation speech', content: 'Fishing is mentioned in paragraph 40.' },
      { ...article('https://publisher.example/low-score'), score: 0.1 },
    ] });
  } });
  assert.deepEqual(result.items, []);
  assert.equal(calls, 1);
});

test('settings check permission and revision before reads, save redirect exclusions and preserve optional removals', async () => {
  let reads = 0;
  const deps: SearchSettingsServices = {
    requireEdit: async () => {}, configured: () => true,
    read: async () => ({ revision: 0, state: 'idle', usedToday: 0, lastAdded: 0 }),
    fetch: async () => { reads++; return { status: 200, url: 'https://new-client.example', text: '', contentType: 'text/html' }; },
    save: async (revision, value, domains) => {
      assert.equal(revision, 0); assert.deepEqual(domains, ['client.example', 'new-client.example']);
      return { revision: 1, config: value, domains, state: 'queued', usedToday: 0, lastAdded: 0 };
    },
  };
  await assert.rejects(saveNewsSearch({ revision: 0, config }, { ...deps, requireEdit: async () => { throw new Error('FORBIDDEN'); } }), /FORBIDDEN/);
  await assert.rejects(saveNewsSearch({ revision: 3, config }, deps), { code: 'NEWS_SEARCH_CONFLICT' });
  assert.equal(reads, 0);
  const saved = await saveNewsSearch({ revision: 0, config }, deps);
  assert.equal(saved.configured, true); assert.equal(saved.revision, 1); assert.equal('domains' in saved, false);
  await assert.rejects(saveNewsSearch({ revision: 0, config: { ...config, topics: [] } }, deps), { code: 'NEWS_SEARCH_INVALID' });
  await assert.rejects(saveNewsSearch({ revision: 0, config }, { ...deps, configured: () => false }), { code: 'TAVILY_KEY_MISSING' });
});

test('worker reserves before spending, fences completion and yields before its deadline', async () => {
  const calls: string[] = [];
  const deps: NewsSearchWorkerServices = {
    configured: () => true, now: () => now,
    claim: async () => { calls.push('claim'); return claim; },
    collect: async () => { calls.push('provider'); return { items: [], query: 'fish' }; },
    finish: async (_owner, fence, items, query, error) => { assert.equal(fence, claim.fence); assert.deepEqual(items, []); calls.push(error ?? query); return true; },
  };
  assert.equal(await runNewsSearchJob('test-worker', new AbortController().signal, now + 1000, deps), 'yield');
  assert.deepEqual(calls, []);
  assert.equal(await runNewsSearchJob('test-worker', new AbortController().signal, undefined, deps), true);
  assert.deepEqual(calls, ['claim', 'provider', 'fish']);
  calls.length = 0;
  await runNewsSearchJob('test-worker', new AbortController().signal, undefined, { ...deps, configured: () => false });
  assert.deepEqual(calls, ['claim', 'TAVILY_KEY_MISSING']);
});
