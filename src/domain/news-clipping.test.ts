import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clippingDateMatches, clippingSegment, seafoodClippingQuery } from './news-clipping.ts';
import { CLIPPING_PRIORITY_DOMAINS, clippingNewsDomains } from './news-clipping-sources.ts';
import { normalizeEntry } from './news-intake.ts';

const now = Date.parse('2026-11-10T12:00:00Z');

test('the collection cycle covers all segment and language pairs with business terms', () => {
  const cycle = Array.from({ length: 36 }, (_, index) => seafoodClippingQuery(index));
  assert.equal(new Set(cycle.map(item => item.query)).size, 36);
  assert.ok(cycle.every(item => !item.query.includes(' AND ') && item.query.length <= 380));
  assert.ok(cycle.filter(item => item.mode === 'general').every(item => item.query.split(': ')[1]?.split(', ').length === 4));
  assert.deepEqual(cycle.filter(item => item.mode === 'news').map(item => item.language), Array.from({ length: 6 }, () => ['pt', 'en', 'es']).flat());
  assert.match(cycle[0].query, /aquicultura/);
  assert.match(cycle[3].query, /aquaculture.*salmon farming/);
  assert.match(cycle[4].query, /acuicultura/);
});

test('a clipping sweep targets every priority domain, including general press and IntraFish', () => {
  const targeted = new Set(Array.from({ length: 36 }, (_, index) => seafoodClippingQuery(index))
    .flatMap(plan => plan.mode === 'news' ? clippingNewsDomains(plan.segment, plan.language) : []));
  assert.deepEqual(CLIPPING_PRIORITY_DOMAINS.filter(domain => !targeted.has(domain)), []);
  assert.ok(targeted.has('intrafish.com'));
  assert.ok(targeted.has('agenciabrasil.ebc.com.br'));
  assert.ok(!targeted.has('seafoodbrasil.com.br'));
});

test('source wording yields a single primary segment; vague or incidental terms do not', () => {
  assert.equal(clippingSegment('Cotas de pesca do atum para a próxima temporada'), 'fishing');
  assert.equal(clippingSegment('Seafood processing plant expands its cold chain'), 'industry');
  assert.equal(clippingSegment('Venta de pescado en supermercados aumenta'), 'retail');
  assert.equal(clippingSegment('Ministério da Pesca e Aquicultura publica nova regra'), 'institutional');
  assert.equal(clippingSegment('Lula discute o futuro da indústria'), undefined);
});

test('blocked domains, recipes and sponsored tags stay out of intake, but revenue is a business story', () => {
  const item = { url: 'https://outlet.example/news/1', title: 'Receita líquida da tilápia sobe', publishedAt: new Date(now).toISOString() };
  assert.equal(normalizeEntry(item, { now, clipping: true })?.clippingSegment, 'aquaculture');
  assert.equal(normalizeEntry({ ...item, title: 'Receita de tilápia para o fim de semana' }, { now, clipping: true }), undefined);
  assert.equal(normalizeEntry({ ...item, tags: ['Publieditorial'] }, { now, clipping: true }), undefined);
  assert.equal(normalizeEntry({ ...item, url: 'https://google.com/url?url=https://news.seafoodbrasil.com.br/noticia' }, { now }), undefined);
  assert.ok(normalizeEntry({ ...item, url: 'https://outro-seafoodbrasil.com.br/noticia' }, { now }));
});

test('the publication window is rolling and inclusive, and rejects future or missing dates', () => {
  assert.ok(clippingDateMatches('2026-11-09T12:00:00Z', now, 24));
  assert.ok(!clippingDateMatches('2026-11-09T11:59:59Z', now, 24));
  assert.ok(clippingDateMatches('2026-11-09T11:59:59Z', now, 48));
  assert.ok(!clippingDateMatches('2026-11-10T12:00:01Z', now, 48));
  assert.ok(!clippingDateMatches('', now, 8760));
});
