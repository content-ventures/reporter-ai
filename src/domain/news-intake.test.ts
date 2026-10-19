import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  bodyOf,
  canonicalUrl,
  cleanLink,
  feedStateOf,
  NEWS_LIMITS,
  newsMessage,
  normalizeEntries,
  normalizeEntry,
  sourceKindOf,
  storyKey,
  unwrapLink,
} from './news-intake.ts';

const NOW = Date.parse('2026-10-19T15:00:00.000Z');

describe('news links', () => {
  test('the canonical link ignores www, tracking, fragment, query order and the trailing slash', () => {
    const key = 'https://portal.exemplo/mercado/tilapia-exporta?id=7&page=2';
    assert.equal(canonicalUrl('http://www.portal.exemplo/mercado/tilapia-exporta/?page=2&utm_source=feed&id=7#topo'), key);
    assert.equal(canonicalUrl('https://PORTAL.exemplo/mercado/tilapia-exporta?fbclid=x&page=2&id=7'), key);
    assert.equal(canonicalUrl('https://portal.exemplo/'), 'https://portal.exemplo');
  });

  test('rejects what is not a public web address', () => {
    assert.equal(canonicalUrl('ftp://portal.exemplo/a'), undefined);
    assert.equal(canonicalUrl('https://user:pass@portal.exemplo/a'), undefined);
    assert.equal(canonicalUrl('portal.exemplo/a'), undefined);
  });

  test('unwraps Google redirects to the outlet link and keeps the rest', () => {
    const wrapped = 'https://www.google.com/url?rct=j&sa=t&url=https://g1.globo.com/economia/agro/noticia/tilapia.ghtml&ct=ga&cd=CAIyGg&usg=AOv';
    assert.equal(unwrapLink(wrapped), 'https://g1.globo.com/economia/agro/noticia/tilapia.ghtml');
    assert.equal(cleanLink('https://portal.exemplo/a?utm_medium=rss&x=1#y'), 'https://portal.exemplo/a?x=1');
    assert.equal(unwrapLink('https://www.google.com/search?q=tilapia'), 'https://www.google.com/search?q=tilapia');
  });

  test('a Google Alertas feed is recognized by its address', () => {
    assert.equal(sourceKindOf('https://www.google.com/alerts/feeds/0123/4567'), 'google-alerts');
    assert.equal(sourceKindOf('https://rss.app/feeds/abc.xml'), 'rss');
  });
});

describe('story key', () => {
  test('the same headline from two outlets shares one key, whatever the accents and case', () => {
    assert.equal(
      storyKey('Exportação de tilápia cresce 41% no terceiro trimestre'),
      storyKey('EXPORTACAO DE TILAPIA CRESCE 41% NO TERCEIRO TRIMESTRE'),
    );
    assert.notEqual(storyKey('Exportação de tilápia cresce 41% no terceiro trimestre'), storyKey('Exportação de camarão cresce 41% no terceiro trimestre'));
  });

  test('short or generic headlines are not grouped', () => {
    assert.equal(storyKey('Preço do camarão sobe'), undefined);
    assert.equal(storyKey('Veja as fotos'), undefined);
  });
});

describe('normalized news', () => {
  test('cleans the text, keeps the lead first and clips the excerpt', () => {
    const long = `${'Pescadores do litoral norte relatam queda na captura. '.repeat(12)}`;
    const item = normalizeEntry({
      id: ' tag:portal,2026:42 ',
      url: 'https://www.portal.exemplo/noticia?utm_source=rss',
      title: '  Pesca   artesanal​ enfrenta queda na captura de camarão  ',
      paragraphs: ['Pesca artesanal enfrenta queda na captura de camarão', long, '', long, 'Fim.'],
      publishedAt: 'Mon, 19 Oct 2026 09:30:00 -0300',
    }, { now: NOW, outlet: 'Portal Aquícola' });
    assert.ok(item);
    assert.equal(item.guid, 'tag:portal,2026:42');
    assert.equal(item.url, 'https://www.portal.exemplo/noticia');
    assert.equal(item.canonicalUrl, 'https://portal.exemplo/noticia');
    assert.equal(item.title, 'Pesca artesanal enfrenta queda na captura de camarão');
    assert.equal(item.outlet, 'Portal Aquícola');
    assert.equal(item.publishedAt, '2026-10-19T12:30:00.000Z');
    // The repeated title and the repeated paragraph are dropped; the lead opens the body.
    assert.deepEqual(item.body, [long.trim(), 'Fim.']);
    assert.ok(item.excerpt.length <= NEWS_LIMITS.excerptChars && item.excerpt.endsWith('…'));
    assert.ok(item.storyKey);
  });

  test('an aggregator entry names its outlet from the address; unreadable or future dates are now', () => {
    const now = new Date(NOW).toISOString();
    const named = normalizeEntry({ url: 'https://www.google.com/url?url=https://www.estadao.com.br/agro/pesca/', title: 'Pesca' }, { now: NOW });
    assert.equal(named?.outlet, 'estadao.com.br');
    assert.equal(named?.guid, 'https://estadao.com.br/agro/pesca');
    assert.equal(named?.publishedAt, now);
    assert.equal(normalizeEntry({ url: 'https://a.exemplo/x', title: 'X', publishedAt: '2027-01-01T00:00:00Z' }, { now: NOW })?.publishedAt, now);
    assert.equal(normalizeEntry({ url: 'https://a.exemplo/x', title: '' }, { now: NOW }), undefined);
    assert.equal(normalizeEntry({ url: 'javascript:alert(1)', title: 'X' }, { now: NOW }), undefined);
  });

  test('a feed keeps one entry per link, newest first, within the window and the limit', () => {
    const day = 86_400_000;
    const entries = [
      { url: 'https://a.exemplo/1', title: 'Um', publishedAt: new Date(NOW - day).toISOString() },
      { url: 'https://www.a.exemplo/1/?utm_campaign=x', title: 'Um de novo', publishedAt: new Date(NOW - day).toISOString() },
      { url: 'https://a.exemplo/2', title: 'Dois', publishedAt: new Date(NOW - 2 * 3_600_000).toISOString() },
      { url: 'https://a.exemplo/3', title: 'Antiga', publishedAt: new Date(NOW - 9 * day).toISOString() },
      { url: 'https://a.exemplo/4', title: 'Quatro', publishedAt: new Date(NOW - 3 * day).toISOString() },
    ];
    const since = NOW - NEWS_LIMITS.firstReadDays * day;
    assert.deepEqual(normalizeEntries(entries, { now: NOW, since }).map((item) => item.title), ['Dois', 'Um', 'Quatro']);
    assert.deepEqual(normalizeEntries(entries, { now: NOW, limit: 2 }).map((item) => item.title), ['Dois', 'Um']);
  });

  test('the body stops at the size limit', () => {
    const paragraphs = ['a', 'b', 'c', 'd'].map((letter) => letter.repeat(6000));
    assert.equal(bodyOf(paragraphs).length, 3);
  });
});

describe('source state', () => {
  test('a source fails after three failed reads in a row; paused wins', () => {
    assert.equal(feedStateOf({ paused: false, failures: 2 }), 'active');
    assert.equal(feedStateOf({ paused: false, failures: 3 }), 'failing');
    assert.equal(feedStateOf({ paused: true, failures: 5 }), 'paused');
  });

  test('failure codes read in words', () => {
    assert.equal(newsMessage('NEWS_TIMEOUT'), 'O endereço não respondeu em 15 segundos.');
    assert.equal(newsMessage('HTTP_404'), 'O endereço não existe mais.');
    assert.equal(newsMessage('HTTP_403'), 'O site recusou a leitura automática.');
    assert.equal(newsMessage('HTTP_418'), 'O endereço respondeu com erro 418.');
    assert.equal(newsMessage('SOMETHING'), 'A leitura falhou.');
    assert.equal(newsMessage(undefined), undefined);
  });
});
