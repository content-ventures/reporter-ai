import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newsSearchQuery, searchDomain, searchExcluded } from './news-search.ts';
import type { NewsSearchConfig } from './news-search.ts';

test('saved query rotation covers every topic and language without treating the client as a topic', () => {
  const config: NewsSearchConfig = { portalUrl: 'https://client.example', sector: 'aquicultura', region: 'Brasil', topics: ['tilápia', 'camarão'],
    languages: ['pt', 'en', 'es'], excludedDomains: [], enabled: true, dailyLimit: 12, everyMinutes: 60 };
  const queries = Array.from({ length: 6 }, (_, index) => newsSearchQuery(config, index));
  assert.equal(new Set(queries.map(item => item.query)).size, 6);
  assert.ok(queries.every(item => !item.query.includes('client.example')));
  assert.equal(queries[5].language, 'es'); assert.ok(queries[5].query.includes('camarão'));
});
test('domain exclusions include redirects and subdomains but not similarly named publishers', () => {
  assert.equal(searchDomain('https://www.client.example/sector'), 'client.example');
  assert.equal(searchDomain('localhost'), undefined);
  assert.equal(searchExcluded('https://news.client.example/article', ['client.example']), true);
  assert.equal(searchExcluded('https://notclient.example/article', ['client.example']), false);
  assert.equal(searchExcluded('file:///etc/passwd', []), true);
});
