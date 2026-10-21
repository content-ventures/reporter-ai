import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FactSource } from '../src/domain/fact-check.ts';
import { discoveryAddress, discoveryCandidates, discoveryQueries, NEWS_DISCOVERY_LIMITS } from '../src/domain/news-discovery.ts';
import { FlowError } from '../src/server/errors.ts';
import { discoverNewsSources } from '../src/server/news-discovery.ts';
import type { NewsDiscoveryServices } from '../src/server/news-discovery.ts';
import { fetchText } from '../src/server/news-fetch.ts';

const NOW = Date.parse('2026-10-21T15:00:00Z');
const result = (url: string, title = 'Notícias de aquicultura'): FactSource => ({ url, title, site: new URL(url).hostname,
  excerpt: 'Notícias sobre produção de pescado e aquicultura.' });
const response = (url: string, text: string) => ({ status: 200 as const, url, text, contentType: 'text/html' });
const feed = (site: string, dates = ['2026-10-21T10:00:00Z']) => JSON.stringify({ version: 'https://jsonfeed.org/version/1.1',
  title: 'Jornal da Aquicultura', home_page_url: site,
  items: dates.map((date, index) => ({ id: String(index), url: `${site}/noticia-${index}`, title: `Produção de pescado ${index}`,
    content_text: 'Dados do setor.', ...(date ? { date_published: date } : {}) })) });

function dependencies(overrides: Partial<NewsDiscoveryServices> = {}): NewsDiscoveryServices {
  return { now: () => NOW, configured: () => true, search: async () => [],
    fetch: async () => { throw new Error('Unexpected fetch'); }, ...overrides };
}

test('requires an explicit portal or sector, and a configured search before any network work', async () => {
  let calls = 0;
  const deps = dependencies({ search: async () => { calls++; return []; }, fetch: async () => { calls++; throw new Error(); } });
  for (const input of [{}, { region: 'Brasil' }, { sector: ' ' }, { portalUrl: 'file:///etc/passwd' }, { sector: 'pescado', unknown: true }])
    await assert.rejects(discoverNewsSources(input, deps), { code: 'NEWS_DISCOVERY_INPUT' });
  await assert.rejects(discoverNewsSources({ portalUrl: 'https://portal.example' }, { ...deps, configured: () => false }),
    (error: unknown) => error instanceof FlowError && error.code === 'TAVILY_KEY_MISSING' && Boolean(error.reason?.includes('administrador')));
  assert.equal(calls, 0);
});

test('portal-only discovery uses its actual public metadata and never claims to infer a sector', async () => {
  const queries: string[] = [];
  const output = await discoverNewsSources({ portalUrl: 'https://portal.example', region: 'Brasil' }, dependencies({
    fetch: async url => response(url, '<title>Portal Mar</title><meta name="description" content="Aquicultura &amp; mercado de pescado">'),
    search: async query => { queries.push(query); return []; },
  }));
  assert.equal(output.context.sector, undefined);
  assert.deepEqual(output.context, { region: 'Brasil', portal: { url: 'https://portal.example', title: 'Portal Mar', description: 'Aquicultura & mercado de pescado' } });
  assert.equal(queries.length, 2);
  assert.ok(queries.every(query => query.includes('Aquicultura & mercado de pescado') && query.includes('Brasil')));
  assert.equal(output.suggestions.length, 1, 'the supplied portal is also checked as a real source');
  assert.equal(output.suggestions[0].site, 'https://portal.example');
  assert.match(output.suggestions[0].reason, /^Portal informado:/);
  assert.equal(output.checkedAt, new Date(NOW).toISOString());
});

test('a portal without a useful public description asks for the sector instead of guessing', async () => {
  let searches = 0;
  await assert.rejects(discoverNewsSources({ portalUrl: 'https://portal.example' }, dependencies({
    fetch: async url => response(url, '<title>Home</title>'), search: async () => { searches++; return []; },
  })), { code: 'NEWS_DISCOVERY_CONTEXT' });
  assert.equal(searches, 0);
  assert.ok(discoveryQueries({ sector: 'Pescado', portal: { url: 'https://portal.example', title: 'Título genérico' } })
    .every(query => query.startsWith('Pescado') && !query.includes('genérico')));
});

test('only a parsed, announced feed is verified; sample dates are genuine and recent', async () => {
  const read: string[] = [];
  const output = await discoverNewsSources({ sector: 'Aquicultura' }, dependencies({
    search: async () => [result('https://jornal.example/noticia')],
    fetch: async (url, options) => {
      assert.ok(options.signal);
      read.push(url);
      if (url === 'https://jornal.example/noticia') return response(url, '<link rel="alternate" type="application/feed+json" href="/noticias.json">');
      assert.equal(url, 'https://jornal.example/noticias.json');
      return response(url, feed('https://jornal.example', ['2026-10-21T10:00:00Z', '2020-01-01T00:00:00Z', '', '2026-12-01T00:00:00Z']));
    },
  }));
  const [suggestion] = output.suggestions;
  assert.equal(output.suggestions.length, 1, 'the same site from both searches is checked once');
  assert.equal(suggestion.status, 'verified');
  assert.equal(suggestion.feedUrl, 'https://jornal.example/noticias.json');
  assert.equal(suggestion.name, 'Jornal da Aquicultura');
  assert.equal(suggestion.recentItems, 1);
  assert.deepEqual(suggestion.sample, [{ title: 'Produção de pescado 0', url: 'https://jornal.example/noticia-0', publishedAt: '2026-10-21T10:00:00.000Z' }]);
  assert.deepEqual(read, ['https://jornal.example/noticia', 'https://jornal.example/noticias.json']);
  assert.equal(suggestion.evidence.url, 'https://jornal.example/noticia');
});

test('an unsuccessful conventional probe never becomes a verified feed', async () => {
  const read: string[] = [];
  const { suggestions: [suggestion] } = await discoverNewsSources({ sector: 'Aquicultura' }, dependencies({
    search: async () => [result('https://semfeed.example/noticia')],
    fetch: async url => { read.push(url); return response(url, '<title>Site sem feed</title>'); },
  }));
  assert.equal(suggestion.status, 'no-feed');
  assert.equal(suggestion.feedUrl, undefined);
  assert.deepEqual(suggestion.sample, []);
  assert.deepEqual(read, ['https://semfeed.example/noticia', 'https://semfeed.example', 'https://semfeed.example/feed/', 'https://semfeed.example/rss']);
});

test('a conventional WordPress feed is offered only after fetching and parsing it', async () => {
  const read: string[] = [];
  const { suggestions: [suggestion] } = await discoverNewsSources({ sector: 'Aquicultura' }, dependencies({
    search: async () => [result('https://jornal.example/peixes/noticia')],
    fetch: async url => {
      read.push(url);
      return response(url, url.endsWith('/feed/') ? feed('https://jornal.example') : '<title>Jornal</title>');
    },
  }));
  assert.equal(suggestion.status, 'verified');
  assert.equal(suggestion.feedUrl, 'https://jornal.example/feed/');
  assert.equal(suggestion.recentItems, 1);
  assert.ok(read.includes(suggestion.feedUrl!));
  assert.equal(read.length, 4);
});

test('visible RSS links retain their section and are checked before root probes', async () => {
  const read: string[] = [];
  const { suggestions: [suggestion] } = await discoverNewsSources({ sector: 'Aquicultura' }, dependencies({
    search: async () => [result('https://jornal.example/peixes/noticia')],
    fetch: async url => {
      read.push(url);
      return response(url, url.endsWith('/peixes/rss.xml') ? feed('https://jornal.example') : '<a href="rss.xml">RSS desta editoria</a>');
    },
  }));
  assert.equal(suggestion.feedUrl, 'https://jornal.example/peixes/rss.xml');
  assert.deepEqual(read, ['https://jornal.example/peixes/noticia', 'https://jornal.example/peixes/rss.xml']);
});

test('verified sources with recent items come first; stale feeds disclose the empty collection window', async () => {
  const { suggestions } = await discoverNewsSources({ sector: 'Aquicultura' }, dependencies({
    search: async () => [result('https://semfeed.example'), result('https://antigo.example'), result('https://recente.example')],
    fetch: async url => response(url, url.includes('semfeed') ? '<title>Sem feed</title>'
      : feed(url, url.includes('antigo') ? ['2020-01-01T00:00:00Z'] : undefined)),
  }));
  assert.deepEqual(suggestions.map(item => item.site), ['https://recente.example', 'https://antigo.example', 'https://semfeed.example']);
  assert.equal(suggestions[1].status, 'verified');
  assert.equal(suggestions[1].recentItems, 0);
  assert.match(suggestions[1].issue!, /não informou notícias dos últimos 7 dias/);
});

test('a supplied portal comes first, then search relevance is preserved regardless of feed volume', async () => {
  const { suggestions } = await discoverNewsSources({ portalUrl: 'https://portal.example', sector: 'Aquicultura' }, dependencies({
    search: async () => [result('https://especializado.example'), result('https://prefeitura.example')],
    fetch: async url => {
      if (url === 'https://portal.example') return response(url, '<title>Portal do Pescado</title><link rel="alternate" type="application/feed+json" href="/feed.json">');
      const site = new URL(url).origin;
      return response(url, feed(site, Array.from({ length: site.includes('prefeitura') ? 50 : 1 }, () => '2026-10-21T10:00:00Z')));
    },
  }));
  assert.deepEqual(suggestions.map(item => item.site),
    ['https://portal.example', 'https://especializado.example', 'https://prefeitura.example']);
  assert.deepEqual(suggestions.map(item => item.recentItems), [1, 1, 50]);
});

test('a failed declared feed does not hide a working second feed, and attempts are capped', async () => {
  const read: string[] = [];
  const { suggestions: [suggestion] } = await discoverNewsSources({ sector: 'Aquicultura' }, dependencies({
    search: async () => [result('https://jornal.example')],
    fetch: async url => {
      read.push(url);
      if (url.endsWith('/broken')) throw new Error('Broken feed');
      if (url.endsWith('/working')) return response(url, feed('https://jornal.example'));
      return response(url, ['/broken', '/working', '/third'].map(href => `<link rel="alternate" type="application/rss+xml" href="${href}">`).join(''));
    },
  }));
  assert.equal(suggestion.status, 'verified');
  assert.equal(suggestion.feedUrl, 'https://jornal.example/working');
  assert.equal(read.length, 3);
  assert.ok(!read.some(url => url.endsWith('/third')));
});

test('untrusted search and declared feed addresses still pass the SSRF-safe fetch boundary', async () => {
  let networkCalls = 0;
  const guarded: NewsDiscoveryServices['fetch'] = (url, options) => fetchText(url, options, {
    lookup: async () => [{ address: '127.0.0.1' }],
    fetch: async () => { networkCalls++; throw new Error('Private network must never be reached'); },
  });
  const { suggestions: [suggestion] } = await discoverNewsSources({ sector: 'Aquicultura' }, dependencies({
    search: async () => [result('https://unsafe.example/internal')], fetch: guarded,
  }));
  assert.equal(suggestion.status, 'unavailable');
  assert.equal(suggestion.feedUrl, undefined);
  assert.equal(networkCalls, 0);
});

test('candidate count and concurrent verifications stay bounded; duplicates are excluded', async () => {
  const found = Array.from({ length: 12 }, (_, index) => result(`https://jornal${index}.example`));
  assert.equal(discoveryCandidates([result('https://www.portal.example/a'), result('https://portal.example/b'), ...found], 'https://portal.example').length,
    NEWS_DISCOVERY_LIMITS.candidates);
  let active = 0, peak = 0, calls = 0;
  const { suggestions } = await discoverNewsSources({ sector: 'Aquicultura' }, dependencies({ search: async () => found,
    fetch: async url => {
      active++; calls++; peak = Math.max(peak, active);
      await new Promise<void>(resolve => setImmediate(resolve));
      active--;
      return response(url, feed(url));
    },
  }));
  assert.equal(suggestions.length, NEWS_DISCOVERY_LIMITS.candidates);
  assert.equal(calls, NEWS_DISCOVERY_LIMITS.candidates);
  assert.equal(peak, NEWS_DISCOVERY_LIMITS.concurrency);
});

test('queries separately seek specialized publishers and current news; candidate rules exclude academic catalogues and PDFs', () => {
  const queries = discoveryQueries({ sector: 'pescados, aquicultura e pesca', region: 'Brasil' });
  assert.deepEqual(queries, [
    'pescados, aquicultura e pesca Brasil portal revista especializada notícias',
    'pescados, aquicultura e pesca Brasil últimas notícias',
  ]);
  const portalQueries = discoveryQueries({ portal: { url: 'https://portal.example', title: 'Marca do portal', description: 'Pescados e aquicultura' } });
  assert.ok(portalQueries.every(query => query.startsWith('Pescados e aquicultura') && !query.includes('Marca do portal')));
  for (const url of ['https://instituto.example/manual.pdf', 'https://repositorio.universidade.example/123',
    'https://universidade.example/periodicos/feed', 'https://biblioteca.example/handle/1/2', 'https://revista.example/article/view/17'])
    assert.equal(discoveryAddress(url), false);
  const catalogue = { ...result('https://proedu.example'), title: 'Repositório de materiais didáticos' };
  const press = { ...result('https://instituto.example/noticias/pescado'), title: 'Instituto lança repositório de materiais' };
  assert.deepEqual(discoveryCandidates([catalogue, press, result('https://jornal.example/peixes')]).map(item => item.url),
    [press.url, 'https://jornal.example/peixes']);
});

test('provider refusals are preserved and caller cancellation starts no provider work', async () => {
  const denied = new FlowError('TAVILY_QUOTA_EXHAUSTED', 502);
  await assert.rejects(discoverNewsSources({ sector: 'Aquicultura' }, dependencies({ search: async () => { throw denied; } })), error => error === denied);
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(discoverNewsSources({ sector: 'Aquicultura' }, dependencies({ search: async () => { calls++; return []; } }), controller.signal),
    { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('cancellation bounds a provider that ignores its signal', async () => {
  const controller = new AbortController();
  const discovering = discoverNewsSources({ sector: 'Aquicultura' }, dependencies({
    search: async () => {
      setImmediate(() => controller.abort());
      return new Promise<FactSource[]>(() => {});
    },
  }), controller.signal);
  await assert.rejects(discovering, { code: 'NEWS_DISCOVERY_TIMEOUT' });
});
