import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { charsetOf, fetchText } from '../src/server/news-fetch.ts';
import type { FetchServices } from '../src/server/news-fetch.ts';
import { discoverFeeds, htmlParagraphs, parseArticlePage, parseFeed } from '../src/server/news-parse.ts';
import { entriesFor } from '../src/server/news-reader.ts';
import { addSource, feedView, firstRead, importLink, itemView, parseNewsPageCursor, readSourceNow, removeSource, resolveFeed, updateSource } from '../src/server/news-intake.ts';
import type { NewsServices } from '../src/server/news-intake.ts';
import { FlowError } from '../src/server/errors.ts';
import { createRssAppFeed, deleteRssAppFeed } from '../src/server/rss-app.ts';

const NOW = Date.parse('2026-10-19T15:00:00.000Z');

test('news page cursors validate bounded input and preserve microseconds at equal timestamp boundaries', () => {
  const cursor = { updatedAt: '2026-10-21T12:30:45.123456+00:00', id: '6b1f8a8e-2f7c-4d55-9a51-6f0f3f8d7a10', until: '2026-10-21T12:31:00.654321+00:00' };
  assert.deepEqual(parseNewsPageCursor(JSON.stringify(cursor)), cursor);
  assert.equal(parseNewsPageCursor(undefined), undefined);
  for (const value of ['{', 'null', 'x'.repeat(513), JSON.stringify({ ...cursor, id: 'bad' }),
    JSON.stringify({ ...cursor, updatedAt: '2026-10-22T12:00:00Z' }),
    JSON.stringify({ ...cursor, until: 'not a date' }), JSON.stringify({ ...cursor, extra: true })]) {
    assert.throws(() => parseNewsPageCursor(value), { code: 'INVALID_INPUT', status: 422 });
  }
});

describe('news write permission', () => {
  test('refuses source and link mutations before any fetch, external account call or database mutation', async () => {
    const calls: string[] = [];
    const unexpected = async () => { calls.push('external'); throw new Error('An external call ran before authorization'); };
    const deps: NewsServices = {
      requireEdit: async () => { calls.push('permission'); throw new FlowError('FORBIDDEN', 403); },
      fetch: unexpected, createRssApp: unexpected, deleteRssApp: unexpected,
      rssApp: () => { calls.push('account'); return true; }, now: () => NOW,
    };
    const sourceId = '6b1f8a8e-2f7c-4d55-9a51-6f0f3f8d7a10';
    const actions = [
      () => addSource({ kind: 'rss', url: 'https://portal.exemplo/feed', everyMinutes: 60 }, deps),
      () => addSource({ kind: 'rss-app', site: 'https://portal.exemplo', everyMinutes: 60 }, deps),
      () => importLink({ url: 'https://portal.exemplo/article' }, deps),
      () => readSourceNow(sourceId, deps),
      () => updateSource(sourceId, { paused: true }, deps),
      () => removeSource(sourceId, deps),
    ];
    for (const action of actions) {
      calls.length = 0;
      await assert.rejects(action, { code: 'FORBIDDEN', status: 403 });
      assert.deepEqual(calls, ['permission']);
    }
  });
});

describe('source first read and news text', () => {
  const source = {
    id: '6b1f8a8e-2f7c-4d55-9a51-6f0f3f8d7a10', kind: 'rss' as const, name: 'Portal',
    url: 'https://portal.exemplo/feed', everyMinutes: 60, paused: false, failures: 0,
  };

  test('keeps a saved source with an actionable failure when its first collection fails', async () => {
    let failure: string | undefined;
    const result = await firstRead(source, [], {}, {
      claim: async () => ({ id: source.id, kind: source.kind, name: source.name, url: source.url, firstRead: true }),
      ingest: async () => { throw new FlowError('NEWS_TIMEOUT'); },
      failed: async (_role, _claim, _owner, code) => { failure = code; },
      source: async () => ({ ...source, failures: 1, lastError: failure }),
    });
    assert.equal(failure, 'NEWS_TIMEOUT');
    assert.equal(result.source.id, source.id);
    assert.equal(result.source.state, 'failing');
    assert.ok(result.source.lastError);
    assert.equal(result.inserted, 0);
    assert.equal(result.grouped, 0);
    assert.equal(feedView({ ...source, paused: true, failures: 1, lastError: failure }).state, 'paused');
  });

  test('marks feed text and page extraction honestly and keeps a long single paragraph intact', () => {
    const paragraph = 'Este primeiro parágrafo precisa permanecer completo. '.repeat(20);
    const stored = {
      id: '0c2b3d4e-5f60-4718-8a9b-0c1d2e3f4a5b', title: 'Notícia', url: 'https://portal.exemplo/article',
      via: 'rss' as const, outlet: 'Portal', excerpt: paragraph.slice(0, 400),
      publishedAt: new Date(NOW).toISOString(), importedAt: new Date(NOW).toISOString(),
      duplicates: [], paragraphs: 1,
    };
    const summary = itemView(stored);
    assert.equal(summary.contentKind, 'feed');
    assert.equal(summary.paragraphs, 1);
    const article = itemView({ ...stored, via: 'url', body: [paragraph] });
    assert.equal(article.contentKind, 'article');
    assert.equal(article.paragraphs, undefined);
    assert.deepEqual(article.body, [paragraph]);
  });

  test('projects original images in summaries and details, omitting absent or unsafe addresses', () => {
    const stored = { id: source.id, title: 'Fish harvest', url: 'https://news.example/fish', via: 'rss' as const,
      outlet: 'News', excerpt: 'The harvest rose.', publishedAt: new Date(NOW).toISOString(),
      importedAt: new Date(NOW).toISOString(), duplicates: [], paragraphs: 1 };
    for (const imageUrl of ['https://images.example/fish.jpg?width=900', 'http://images.example/fish.jpg']) {
      assert.equal(itemView({ ...stored, imageUrl }).imageUrl, imageUrl);
      assert.equal(itemView({ ...stored, imageUrl, body: ['The harvest rose.'] }).imageUrl, imageUrl);
    }
    for (const imageUrl of [undefined, '', '   ', '/fish.jpg', '//images.example/fish.jpg', 'not a URL',
      'javascript:alert(1)', 'data:image/png;base64,AA==', 'file:///fish.jpg', 'ftp://images.example/fish.jpg',
      'https://user:secret@images.example/fish.jpg', 'http://localhost/fish.jpg', 'http://LOCALHOST./fish.jpg',
      'http://photos.localhost/fish.jpg', 'http://photos.local/fish.jpg', 'http://127.0.0.1/fish.jpg',
      'http://2130706433/fish.jpg', 'http://10.1.2.3/fish.jpg', 'http://169.254.169.254/fish.jpg',
      'http://192.168.1.1/fish.jpg', 'http://[::1]/fish.jpg', 'http://[fd00::1]/fish.jpg']) {
      assert.equal(Object.hasOwn(itemView({ ...stored, imageUrl }), 'imageUrl'), false, `image: ${imageUrl}`);
    }
  });

  test('projects translated titles, leads and text without overwriting the stored publication', () => {
    const stored = { id: source.id, title: 'Fish exports rise', url: 'https://foreign.example/news', via: 'rss' as const,
      imageUrl: 'https://foreign.example/images/original.jpg',
      outlet: 'Foreign publisher', excerpt: 'Exports rose 10%.', body: ['Exports rose 10%.'],
      publishedAt: new Date(NOW).toISOString(), importedAt: new Date(NOW).toISOString(), duplicates: [], paragraphs: 1,
      translation: { status: 'translated' as const, targetLanguage: 'pt-BR' as const, sourceLanguage: 'en',
        title: 'Exportações de peixe crescem', excerpt: 'As exportações cresceram 10%.', body: ['As exportações cresceram 10%.'] } };
    const projected = itemView(stored);
    assert.equal(projected.title, stored.translation.title);
    assert.equal(projected.excerpt, stored.translation.excerpt);
    assert.deepEqual(projected.body, stored.translation.body);
    assert.equal(projected.url, stored.url);
    assert.equal(projected.imageUrl, stored.imageUrl);
    assert.equal(projected.source, stored.outlet);
    assert.equal(projected.paragraphs, undefined);
    assert.equal(stored.title, 'Fish exports rise');
    assert.deepEqual(projected.translation, { status: 'translated', targetLanguage: 'pt-BR', sourceLanguage: 'en' });
    const summary = itemView({ ...stored, body: undefined, translation: { ...stored.translation, body: undefined } });
    assert.equal(summary.paragraphs, 1);
    assert.equal(summary.imageUrl, stored.imageUrl);
    assert.deepEqual(summary.body, [stored.translation.excerpt]);
    for (const status of ['pending', 'failed', 'original'] as const) {
      const untranslated = itemView({ ...stored, translation: { status, targetLanguage: 'pt-BR' } });
      assert.equal(untranslated.title, stored.title);
      assert.equal(untranslated.imageUrl, stored.imageUrl);
      assert.deepEqual(untranslated.body, stored.body);
    }
  });
});

const WORDPRESS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
  <title>Portal Aquícola</title><link>https://portalaquicola.exemplo</link>
  <item>
    <title>Exportação de tilápia cresce 41% no terceiro trimestre</title>
    <link>https://portalaquicola.exemplo/tilapia-cresce/?utm_source=rss&amp;utm_medium=rss</link>
    <guid isPermaLink="false">https://portalaquicola.exemplo/?p=4201</guid>
    <pubDate>Mon, 19 Oct 2026 09:30:00 -0300</pubDate>
    <description><![CDATA[<p>O Brasil embarcou 4,1 mil toneladas.</p> <p>Leia mais…</p>]]></description>
    <content:encoded><![CDATA[<p>O Brasil embarcou 4,1 mil toneladas de tilápia.</p><figure><img src="https://portalaquicola.exemplo/foto.jpg"/><figcaption>Foto</figcaption></figure><p>Paraná e São Paulo lideram.</p><script>track()</script>]]></content:encoded>
    <media:content url="https://portalaquicola.exemplo/capa.jpg" medium="image"/>
  </item>
  <item>
    <title>Sem link</title>
  </item>
</channel></rss>`;

const ALERTS = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:idx="urn:atom-extension:indexing">
  <id>tag:google.com,2005:reader/user/0/state/com.google/alerts/123</id>
  <title>Alerta do Google - tilápia</title>
  <link href="https://www.google.com/alerts/feeds/0/123" rel="self"/>
  <entry>
    <id>tag:google.com,2013:googlealerts/feed:999</id>
    <title type="html">Exportação de &lt;b&gt;tilápia&lt;/b&gt; bate recorde</title>
    <link href="https://www.google.com/url?rct=j&amp;sa=t&amp;url=https://g1.globo.com/economia/agronegocios/noticia/2026/10/19/tilapia.ghtml&amp;ct=ga&amp;cd=CAIyGg&amp;usg=AOvVaw"/>
    <published>2026-10-19T13:12:00Z</published>
    <updated>2026-10-19T13:12:00Z</updated>
    <content type="html">O setor de &lt;b&gt;tilápia&lt;/b&gt; exportou mais em setembro.</content>
  </entry>
</feed>`;

const JSON_FEED = JSON.stringify({
  version: 'https://jsonfeed.org/version/1.1', title: 'Mar & Mercado', home_page_url: 'https://maremercado.exemplo',
  items: [{ id: 7, url: 'https://maremercado.exemplo/camarao', title: 'Camarão', content_text: 'Primeiro.\n\nSegundo.', date_published: '2026-10-19T10:00:00Z' }],
});

const ARTICLE = `<!doctype html><html><head>
  <title>Preço do camarão | Revista</title>
  <link rel="canonical" href="https://www.revista.exemplo/mercado/preco-camarao">
  <meta property="og:site_name" content="Revista Mar">
  <meta property="og:description" content="O quilo subiu 12% em setembro.">
  <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"Revista"},
    {"@type":"NewsArticle","headline":"Preço do camarão sobe 12% em setembro","datePublished":"2026-10-19T08:00:00-03:00",
     "image":[{"url":"https://www.revista.exemplo/camarao.jpg"}],"publisher":{"@type":"Organization","name":"Revista Mar"}}]}</script>
</head><body>
  <nav><p>Menu de navegação com muitos links para outras seções do portal inteiro</p></nav>
  <article><h1>Preço do camarão sobe 12%</h1><p>O quilo subiu 12% em setembro.</p><p>Produtores atribuem a alta à seca no Nordeste.</p>
  <aside><p>Leia também</p></aside></article>
</body></html>`;

describe('feeds', () => {
  test('RSS keeps the full content, drops scripts and figures, finds the image', () => {
    const feed = parseFeed(WORDPRESS);
    assert.equal(feed?.format, 'rss');
    assert.equal(feed?.title, 'Portal Aquícola');
    const [entry] = feed!.entries;
    assert.equal(entry.id, 'https://portalaquicola.exemplo/?p=4201');
    assert.deepEqual(entry.paragraphs, ['O Brasil embarcou 4,1 mil toneladas de tilápia.', 'Paraná e São Paulo lideram.']);
    assert.equal(entry.image, 'https://portalaquicola.exemplo/capa.jpg');
    const [item, ...rest] = entriesFor({ kind: 'rss', name: 'Portal Aquícola', firstRead: true }, feed!.entries, NOW);
    assert.equal(rest.length, 0, 'an entry without a link is left out');
    assert.equal(item.url, 'https://portalaquicola.exemplo/tilapia-cresce/');
    assert.equal(item.outlet, 'Portal Aquícola');
    assert.equal(item.publishedAt, '2026-10-19T12:30:00.000Z');
  });

  test('Google Alertas: the outlet link unwrapped, the bold keyword dropped, the outlet from the address', () => {
    const feed = parseFeed(ALERTS);
    assert.equal(feed?.format, 'atom');
    const [item] = entriesFor({ kind: 'google-alerts', name: 'tilápia', keyword: 'tilápia', firstRead: false }, feed!.entries, NOW);
    assert.equal(item.url, 'https://g1.globo.com/economia/agronegocios/noticia/2026/10/19/tilapia.ghtml');
    assert.equal(item.title, 'Exportação de tilápia bate recorde');
    assert.equal(item.outlet, 'g1.globo.com');
    assert.deepEqual(item.body, ['O setor de tilápia exportou mais em setembro.']);
  });

  test('JSON Feed and refusal of anything else', () => {
    const feed = parseFeed(JSON_FEED);
    assert.equal(feed?.format, 'json');
    assert.equal(feed?.entries[0].id, '7');
    assert.deepEqual(feed?.entries[0].paragraphs, ['Primeiro.', 'Segundo.']);
    assert.equal(parseFeed('<html><body>Não é feed</body></html>'), undefined);
    assert.equal(parseFeed('{"items":[]}'), undefined);
    assert.equal(parseFeed('texto'), undefined);
  });

  test('a site page announces its feed', () => {
    const html = '<html><head><link rel="alternate" type="application/rss+xml" href="/feed/"><link rel="alternate" hreflang="en" href="/en"></head></html>';
    assert.deepEqual(discoverFeeds(html, 'https://portal.exemplo/noticias'), ['https://portal.exemplo/feed/']);
  });

  test('plain text descriptions split on blank lines', () => {
    assert.deepEqual(htmlParagraphs('Um.\n\nDois.'), ['Um.', 'Dois.']);
    assert.deepEqual(htmlParagraphs('Texto &amp; mais<br>linha'), ['Texto & mais', 'linha']);
  });
});

describe('pasted link', () => {
  test('a news page: JSON-LD headline and date, the article paragraphs, the canonical address', () => {
    const entry = parseArticlePage(ARTICLE, 'https://revista.exemplo/mercado/preco-camarao?utm_source=whatsapp');
    assert.equal(entry?.title, 'Preço do camarão sobe 12% em setembro');
    assert.equal(entry?.url, 'https://www.revista.exemplo/mercado/preco-camarao');
    assert.equal(entry?.outlet, 'Revista Mar');
    assert.equal(entry?.publishedAt, '2026-10-19T08:00:00-03:00');
    assert.equal(entry?.image, 'https://www.revista.exemplo/camarao.jpg');
    assert.deepEqual(entry?.paragraphs, ['O quilo subiu 12% em setembro.', 'Produtores atribuem a alta à seca no Nordeste.']);
  });

  test('the site name leaves a page title', () => {
    const page = '<html><head><title>Lindt troca CEO após queda nas vendas | G1</title><meta property="og:site_name" content="G1"><meta property="og:type" content="article"><meta property="og:description" content="Empresa reduziu a previsão."></head></html>';
    assert.equal(parseArticlePage(page, 'https://g1.globo.com/a')?.title, 'Lindt troca CEO após queda nas vendas');
    assert.equal(parseArticlePage(page.replace('| G1', '- Opinião'), 'https://g1.globo.com/a')?.title, 'Lindt troca CEO após queda nas vendas - Opinião');
  });

  test('a canonical on another site does not stand for the page; a page without a story is refused', () => {
    const spoofed = ARTICLE.replace('https://www.revista.exemplo/mercado/preco-camarao', 'https://outro.exemplo/x');
    assert.equal(parseArticlePage(spoofed, 'https://revista.exemplo/a')?.url, 'https://revista.exemplo/a');
    assert.equal(parseArticlePage('<html><body><p>oi</p></body></html>', 'https://x.exemplo'), undefined);
  });
});

function fakeNet(routes: Record<string, () => Response>, addresses: Record<string, string> = {}): FetchServices {
  return {
    fetch: async (input) => {
      const url = String(input);
      const route = routes[url];
      if (!route) throw new TypeError('fetch failed');
      return route();
    },
    lookup: async (host) => [{ address: addresses[host] ?? '93.184.216.34' }],
  };
}

describe('fetching', () => {
  const options = { maxBytes: 1024, accept: '*/*' };

  test('private addresses are refused, also behind a redirect', async () => {
    await assert.rejects(fetchText('https://intranet.exemplo/feed', options, fakeNet({}, { 'intranet.exemplo': '10.0.0.5' })), { code: 'NEWS_ADDRESS_BLOCKED' });
    const net = fakeNet({ 'https://portal.exemplo/feed': () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } }) }, { '169.254.169.254': '169.254.169.254' });
    await assert.rejects(fetchText('https://portal.exemplo/feed', options, net), { code: 'NEWS_ADDRESS_BLOCKED' });
    await assert.rejects(fetchText('https://portal.exemplo:8443/feed', options, fakeNet({})), { code: 'NEWS_URL_INVALID' });
  });

  test('cache validators, size cap, HTTP errors and Latin-1 pages', async () => {
    const net = fakeNet({
      'https://a.exemplo/feed': () => new Response(null, { status: 304 }),
      'https://a.exemplo/big': () => new Response('x'.repeat(2048)),
      'https://a.exemplo/gone': () => new Response('no', { status: 410 }),
      'https://a.exemplo/latin': () => new Response(new Uint8Array([0x3c, 0x70, 0x3e, 0x50, 0x65, 0x73, 0x63, 0x61, 0x64, 0x6f, 0x20, 0xe9]), { headers: { 'content-type': 'text/html; charset=ISO-8859-1', etag: '"v2"' } }),
    });
    assert.equal((await fetchText('https://a.exemplo/feed', { ...options, etag: '"v1"' }, net)).status, 304);
    await assert.rejects(fetchText('https://a.exemplo/big', options, net), { code: 'NEWS_TOO_LARGE' });
    await assert.rejects(fetchText('https://a.exemplo/gone', options, net), { code: 'HTTP_410' });
    await assert.rejects(fetchText('https://a.exemplo/down', options, net), { code: 'NEWS_UNREACHABLE' });
    const latin = await fetchText('https://a.exemplo/latin', options, net);
    assert.equal(latin.status === 200 && latin.text, '<p>Pescado é');
    assert.equal(latin.status === 200 && latin.etag, '"v2"');
    assert.equal(charsetOf('', new TextEncoder().encode('<?xml version="1.0" encoding="windows-1252"?><rss/>')), 'windows-1252');
  });

  test('a site address resolves to the feed it announces', async () => {
    const page = '<html><head><link rel="alternate" type="application/rss+xml" href="https://portalaquicola.exemplo/feed/"></head></html>';
    const fetchFeed = async (url: string) => url === 'https://portalaquicola.exemplo/'
      ? { status: 200 as const, url, text: page, contentType: 'text/html' }
      : { status: 200 as const, url, text: WORDPRESS, contentType: 'application/rss+xml', etag: '"f"' };
    const resolved = await resolveFeed('https://portalaquicola.exemplo/', { fetch: fetchFeed });
    assert.equal(resolved.url, 'https://portalaquicola.exemplo/feed/');
    assert.equal(resolved.feed.title, 'Portal Aquícola');
    assert.equal(resolved.etag, '"f"');
    await assert.rejects(resolveFeed('https://x.exemplo/', { fetch: async (url) => ({ status: 200, url, text: '<html></html>', contentType: 'text/html' }) }), { code: 'NEWS_FEED_INVALID' });
  });
});

describe('RSS.app', () => {
  const environment = { RSS_APP_API_KEY: 'c_key', RSS_APP_API_SECRET: 's_secret' };

  test('creates a feed with the key, reads its first items and frees it on removal', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      if (init?.method === 'DELETE') return Response.json({ id: 'tCUoq', deleted: true });
      return Response.json({ id: 'tCUoq', title: 'Portal sem RSS', source_url: 'https://semrss.exemplo', rss_feed_url: 'https://rss.app/feeds/tCUoq.xml',
        items: [{ url: 'https://semrss.exemplo/a', title: 'A', description_text: 'Texto', date_published: '2026-10-19T10:00:00.000Z', authors: [] }, { title: 'sem url' }] });
    }) as typeof globalThis.fetch;
    const feed = await createRssAppFeed({ url: 'https://semrss.exemplo' }, { fetch, environment });
    assert.equal(feed.feedUrl, 'https://rss.app/feeds/tCUoq.xml');
    assert.equal(feed.entries.length, 1);
    assert.equal(calls[0].url, 'https://api.rss.app/v1/feeds');
    assert.equal((calls[0].init?.headers as Record<string, string>).authorization, 'Bearer c_key:s_secret');
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { url: 'https://semrss.exemplo' });
    await createRssAppFeed({ keyword: 'tilápia' }, { fetch, environment: { ...environment, RSS_APP_REGION: 'BR:pt' } });
    assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { keyword: 'tilápia', region: 'BR:pt' });
    await deleteRssAppFeed('tCUoq', { fetch, environment });
    assert.equal(calls[2].url, 'https://api.rss.app/v1/feeds/tCUoq');
  });

  test('without the key nothing is called; refusals become the desk codes', async () => {
    const answer = (status: number, body = '{}') => (async () => new Response(body, { status })) as unknown as typeof globalThis.fetch;
    await assert.rejects(createRssAppFeed({ url: 'https://a.exemplo' }, { fetch: answer(200), environment: {} }), { code: 'RSS_APP_UNCONFIGURED' });
    await assert.rejects(createRssAppFeed({ url: 'https://a.exemplo' }, { fetch: answer(401), environment }), { code: 'RSS_APP_AUTH' });
    await assert.rejects(createRssAppFeed({ url: 'https://a.exemplo' }, { fetch: answer(402, '{"message":"Feed limit reached, upgrade your plan"}'), environment }), { code: 'RSS_APP_LIMIT' });
    await assert.rejects(createRssAppFeed({ url: 'https://a.exemplo' }, { fetch: answer(400, '{"message":"Invalid url"}'), environment }), { code: 'RSS_APP_REFUSED' });
    await assert.rejects(createRssAppFeed({ url: 'https://a.exemplo' }, { fetch: answer(503), environment }), { code: 'RSS_APP_UNAVAILABLE' });
    await assert.rejects(createRssAppFeed({ url: 'https://a.exemplo' }, { fetch: answer(200, '{"id":"x"}'), environment }), { code: 'RSS_APP_UNAVAILABLE' });
    await deleteRssAppFeed('gone', { fetch: answer(404), environment });
  });
});
