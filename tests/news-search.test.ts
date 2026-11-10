import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NewsSearchClaim, NewsSearchConfig } from '../src/domain/news-search.ts';
import { FlowError } from '../src/server/errors.ts';
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

test('page text starts at its headline and stops before related-news navigation', async () => {
  const title = 'Thai Union upgrades monitoring of tuna fleet';
  const paragraphs = ['October 19, 2026', 'Image courtesy Zunibal.', 'Thai Union selected a new monitoring supplier.',
    'The agreement covers onboard equipment installation.', 'AI will accelerate reviews of fishing activity.'];
  const result = await collectSearchNews(claim, new AbortController().signal, { now: () => now, key: () => 'fixture', request: async () =>
    Response.json({ results: [{ ...article('https://publisher.example/news/123'), title: `${title} - Marine Link`,
      images: ['https://publisher.example/fleet.jpg'], raw_content: ['Home', 'Magazines', 'Advertising', 'Equipment', title,
        ...paragraphs, 'Related News', 'Unrelated shipping headlines and navigation.'].join('\n\n') }] }) });
  assert.deepEqual(result.items[0].body, paragraphs);
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

test('Seafood prioritizes the matrix, rejects noise and blocked redirects, and keeps only a paywall preview', async () => {
  const base = (url: string, patch: object = {}) => ({
    ...article(url), title: 'Exportação de tilápia cresce', content: 'Exportadores relatam alta.', ...patch,
  });
  const read: string[] = [];
  const result = await collectSearchNews({ ...claim, clipping: true }, new AbortController().signal, {
    now: () => now, key: () => 'fixture',
    request: async (url, init) => {
      assert.equal(url, 'https://api.tavily.com/search');
      const body = JSON.parse(init?.body as string);
      assert.equal(body.time_range, 'week');
      assert.equal(body.filter_by_published_date, false);
      assert.equal(body.include_domains_mode, 'prefer');
      assert.ok(body.include_domains.includes('seafoodsource.com'));
      assert.ok(body.exclude_domains.includes('seafoodbrasil.com.br'));
      assert.equal(body.include_raw_content, false);
      return Response.json({ results: [
        base('https://publisher.example/tilapia'),
        base('https://another.example/redirect'),
        base('https://sub.seafoodbrasil.com.br/blocked'),
        base('https://publisher.example/recipe', { title: 'Receita de tilápia para o fim de semana' }),
        base('https://publisher.example/old', { published_date: '2026-10-20T15:59:59Z' }),
        base('https://publisher.example/publisher-date', { published_date: null }),
        base('https://publisher.example/undated', { published_date: null }),
        base('https://publisher.example/stale', { published_date: null }),
      ] });
    },
    read: async (url, options) => {
      read.push(url);
      assert.equal(options.clippingIntake, true);
      if (url.endsWith('redirect')) return { status: 200, url: 'https://seafoodbrasil.com.br/blocked', text: '', contentType: 'text/html' };
      const datePublished = url.endsWith('publisher-date') ? '2026-10-21T14:00:00Z'
        : url.endsWith('stale') ? '2026-10-20T15:59:59Z' : undefined;
      return { status: 200, url, contentType: 'text/html', text: `<script type="application/ld+json">
        ${JSON.stringify({ '@type': 'NewsArticle', headline: 'Exportação de tilápia cresce', description: 'Trecho público.',
          datePublished, isAccessibleForFree: false, articleBody: 'Texto restrito que não deve entrar na coleta.' })}
        </script>` };
    },
  });
  assert.deepEqual(read, ['https://publisher.example/tilapia', 'https://another.example/redirect',
    'https://publisher.example/publisher-date', 'https://publisher.example/undated', 'https://publisher.example/stale']);
  assert.deepEqual(result.items.map(item => item.url), ['https://publisher.example/tilapia', 'https://publisher.example/publisher-date']);
  assert.equal(result.items[0].clippingSegment, 'aquaculture');
  assert.equal(result.items[0].contentKind, 'search');
  assert.deepEqual(result.items[0].body, ['Trecho público.']);
});

test('the Seafood news slot reads the priority matrix and confirms lower-ranked matches against the publisher', async () => {
  const url = 'https://fishfocus.co.uk/rules-for-commercial-fishing';
  const reads: string[] = [];
  const result = await collectSearchNews({ ...claim, clipping: true, queryIndex: 9 }, AbortSignal.timeout(1000), {
    now: () => now, key: () => 'fixture', request: async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      assert.equal(body.topic, 'general');
      assert.equal(body.time_range, 'week');
      assert.equal(body.filter_by_language, false);
      assert.equal(body.include_domains_mode, 'restrict');
      assert.ok(body.include_domains.includes('seafoodsource.com'));
      assert.ok(!body.include_domains.includes('bbc.com'));
      const candidate = { ...article(url), title: 'New rules to support stocks', content: 'The rules take effect next year.', score: 0.08 };
      return Response.json({ results: [candidate, { ...candidate, url: 'https://seafoodsource.com/news/unavailable' },
        { ...candidate, url: 'https://fishfocus.co.uk/undated' }, { ...candidate, url: 'https://unrelated.example/news' }] });
    },
    read: async url => {
      reads.push(url);
      if (url.endsWith('unavailable')) throw new FlowError('HTTP_403', 422);
      const metadata = { '@type': 'NewsArticle', headline: 'New rules for commercial fishing',
        datePublished: url.endsWith('undated') ? undefined : '2026-10-21T14:00:00Z',
        articleBody: 'The regulator published new quotas for commercial fishing.' };
      return { status: 200, url, contentType: 'text/html', text: `<script type="application/ld+json">${JSON.stringify(metadata)}</script>` };
    },
  });
  assert.deepEqual(reads, [url, 'https://seafoodsource.com/news/unavailable', 'https://fishfocus.co.uk/undated']);
  assert.deepEqual(result.items.map(item => [item.url, item.contentKind]), [[url, 'article']]);
});

test('undated leads do not use all publisher reads before a dated story whose summary is misleading', async () => {
  const dated = 'https://fishfocus.co.uk/new-fishing-rules-to-support-stocks';
  const reads: string[] = [];
  const result = await collectSearchNews({ ...claim, clipping: true, queryIndex: 3 }, AbortSignal.timeout(1000), {
    now: () => now, key: () => 'fixture',
    request: async () => Response.json({ results: [
      ...Array.from({ length: 5 }, (_, index) => ({ ...article(`https://www.seafoodsource.com/news/${index}`, null),
        title: 'Salmon farming investment expands', score: 0.9 })),
      { ...article(dated), title: 'New Fishing Rules to Support Stocks', content: 'More on salmon farming.', score: 0.65 },
    ] }),
    read: async url => {
      reads.push(url);
      if (url !== dated) throw new FlowError('HTTP_403', 422);
      return { status: 200, url, contentType: 'text/html', text: `<script type="application/ld+json">
        {"@type":"NewsArticle","headline":"New Fishing Rules to Support Stocks",
        "datePublished":"2026-10-21T14:00:00Z","articleBody":"The regulator announced quotas for commercial fishing."}
        </script>` };
    },
  });
  assert.equal(reads.length, 5);
  assert.deepEqual(result.items.map(item => [item.url, item.clippingSegment, item.contentKind]), [[dated, 'fishing', 'article']]);
});
