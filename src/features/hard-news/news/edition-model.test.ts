import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NewsItem } from '../../../domain/hard-news.ts';
import { editionOrder, editionOutlets, editionSignal } from './edition-model.ts';

const NOW = Date.parse('2026-10-21T16:00:00Z');
function item(id: string, hours: number, patch: Partial<NewsItem> = {}): NewsItem {
  return { id, title: id, url: `https://publisher.test/${id}`, source: 'Publisher', via: 'rss',
    publishedAt: new Date(NOW - hours * 3_600_000).toISOString(), importedAt: new Date(NOW).toISOString(),
    status: 'new', body: [], excerpt: '', duplicates: [], ...patch };
}
const classification = { score: 95, topic: 'Pescado', summary: 'Relevante para a pauta', reasons: [], mapVersion: 1 };

test('the live cover uses publication time, not collection order, photo availability or simulated scores', () => {
  const latest = item('latest', 1);
  const older = item('older', 3, { imageUrl: 'https://images.test/fish.jpg', classification });
  assert.deepEqual(editionOrder([older, latest], NOW, false).map(item => item.id), ['latest', 'older']);
  assert.equal(editionSignal(latest, false), undefined, 'the time beside the headline already says it is recent');
  assert.equal(editionSignal(older, false), undefined, 'a simulated priority is not a signal of the live desk');
});

test('source diversity counts distinct publishers and never repeated URLs or feeds', () => {
  const story = item('spread', 2, { duplicates: [
    { url: 'https://www.publisher.test/copy', source: 'Publisher', publishedAt: new Date(NOW).toISOString() },
    { url: 'https://second.test/article', source: 'Second', publishedAt: new Date(NOW).toISOString() },
    { url: 'https://second.test/article?utm_source=rss', source: 'Second RSS', publishedAt: new Date(NOW).toISOString() },
    { url: 'invalid', source: 'Invalid', publishedAt: new Date(NOW).toISOString() },
  ] });
  assert.equal(editionOutlets(story), 2);
  assert.equal(editionOrder([item('latest', 1), story], NOW, false)[0].id, 'spread');
  assert.equal(editionSignal(story, false), 'Em 2 veículos');
});

test('available editorial priorities honor corrections without reviving old backlog as the lead', () => {
  const old = item('old', 48, { classification });
  const corrected = item('corrected', 1, { classification: { ...classification,
    correction: { priority: 'low', by: 'Editor', at: new Date(NOW).toISOString() } } });
  const high = item('high', 2, { classification: { ...classification, score: 80 } });
  assert.deepEqual(editionOrder([old, corrected, high], NOW, true).map(item => item.id), ['high', 'corrected', 'old']);
  assert.equal(editionSignal(corrected, true), 'Prioridade baixa');
});

test('the chronological wire has no repeated cover items and invalid or future dates cannot lead', () => {
  const news = [item('future', -2), item('invalid', 0, { publishedAt: 'invalid' }),
    ...Array.from({ length: 10 }, (_, i) => item(String(i), i + 1))];
  const ordered = editionOrder(news, NOW, false);
  assert.equal(ordered[0].id, '0');
  assert.equal(ordered.length, news.length);
  assert.equal(new Set(ordered.map(item => item.id)).size, news.length);
  assert.deepEqual(ordered.slice(4, 10).map(item => item.id), ['4', '5', '6', '7', '8', '9']);
  assert.deepEqual(editionOrder([], NOW, false), []);
});
