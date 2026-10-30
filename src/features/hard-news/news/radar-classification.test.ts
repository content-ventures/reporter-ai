import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EditorialMap, NewsFeed, NewsItem } from '../../../domain/hard-news.ts';
import { classifyRadarItem } from './radar-classification.ts';

const map: EditorialMap = {
  version: 3, updatedAt: new Date().toISOString(), updatedBy: 'Editor',
  audience: 'cooperativas aquícolas', regions: [],
  topics: [{ id: 'fish', label: 'pesca', weight: 'core' }],
  exclusions: ['pesca esportiva'], trusted: [], blocked: [],
};

function item(title: string, patch: Partial<NewsItem> = {}): NewsItem {
  return {
    id: 'news-1', title, url: 'https://publisher.example/story', source: 'Publisher', feedId: 'feed-1',
    via: 'rss', publishedAt: new Date().toISOString(), importedAt: new Date().toISOString(),
    excerpt: '', body: [], duplicates: [], status: 'new', ...patch,
  };
}

test('editorial terms match whole words and accented text', () => {
  const exact = classifyRadarItem(item('Pesca para cooperativas aquícolas'), [], map).classification!;
  const substring = classifyRadarItem(item('Pesqueiro cresce entre microcooperativas litorâneas'), [], map).classification!;
  assert.equal(exact.topic, 'pesca');
  assert.ok(exact.reasons.some((reason) => reason.criterion === 'Público'));
  assert.equal(substring.topic, 'Sem tema identificado');
  assert.ok(!substring.reasons.some((reason) => reason.criterion === 'Público'));
});

test('an exact exclusion applies, while a longer word containing it does not', () => {
  const excluded = classifyRadarItem(item('Pesca esportiva movimenta o litoral'), [], map).classification!;
  const similar = classifyRadarItem(item('Pesca esportividade movimenta o litoral'), [], map).classification!;
  assert.equal(excluded.score, 0);
  assert.ok(similar.score > 0);
});

test('only an explicit publisher assessment changes source scoring; unassessed stays neutral', () => {
  const unrated: NewsFeed = { id: 'feed-1', name: 'Publisher', url: 'https://publisher.example/rss', everyMinutes: 60, state: 'active', lastDay: 0 };
  const rated: NewsFeed = { ...unrated, rating: { tier: 'A1', relevance: 'high', rationale: 'Referência setorial', updatedAt: new Date().toISOString() } };
  const lowerBase = { ...map, topics: [{ ...map.topics[0], weight: 'occasional' as const }] };
  const withoutAssessment = classifyRadarItem(item('Pesca em cooperativas aquícolas'), [unrated], lowerBase).classification!;
  const assessed = classifyRadarItem(item('Pesca em cooperativas aquícolas'), [rated], lowerBase).classification!;
  assert.equal(assessed.score - withoutAssessment.score, 26);
  assert.equal(withoutAssessment.reasons.some((reason) => reason.criterion === 'Veículo'), false);
  assert.ok(assessed.reasons.some((reason) => reason.criterion === 'Veículo'));
});
