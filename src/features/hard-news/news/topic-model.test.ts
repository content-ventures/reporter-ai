import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NewsItem } from '../../../domain/hard-news.ts';
import { matchesTopic, newsTopics } from './topic-model.ts';

const NOW = Date.parse('2026-10-21T16:00:00Z');
function item(id: string, title: string, hours = 1, patch: Partial<NewsItem> = {}): NewsItem {
  return { id, title, url: `https://fonte${id}.test/${id}`, source: `Fonte ${id}`, via: 'rss',
    publishedAt: new Date(NOW - hours * 3_600_000).toISOString(), importedAt: new Date(NOW).toISOString(),
    status: 'new', body: [], excerpt: '', duplicates: [], ...patch };
}

test('topics count headlines and distinct publishers, never repeated words or feeds', () => {
  const result = newsTopics([
    item('1', 'Tilápia: tilápia brasileira amplia produção', 1, { url: 'https://www.revista.test/1' }),
    item('2', 'Tilapia ganha estudo sobre alimentação', 5, { url: 'https://revista.test/2' }),
    item('3', 'Tilápia entra na pauta de pesquisadores', 9),
  ], NOW);
  assert.equal(result[0].key, 'tilapia');
  assert.equal(result[0].label, 'Tilápia');
  assert.equal(result[0].items.length, 3);
  assert.equal(result[0].sources, 2);
  assert.deepEqual(result[0].points, [0, 0, 0, 1, 1, 1]);
});

test('publication dates determine the window, ignoring imported backlog, invalid dates and future items', () => {
  const items = [item('1', 'Salmão no Brasil', 0), item('2', 'Salmão na exportação', 23.9),
    item('3', 'Salmão na pesca', 24), item('4', 'Salmão no estudo', -1),
    item('5', 'Salmão no comércio', 1, { publishedAt: 'invalid' }),
    item('6', 'Salmão nos mercados', 1, { status: 'discarded' })];
  const topic = newsTopics(items, NOW)[0];
  assert.equal(topic.key, 'salmao');
  assert.deepEqual(topic.items.map(item => item.id), ['1', '2']);
  assert.equal(topic.points.reduce((a, b) => a + b, 0), 2);
  for (const entry of items) assert.equal(matchesTopic(entry, topic.key, NOW), ['1', '2'].includes(entry.id));
});

test('a tracking URL or repeated snapshot cannot inflate a topic', () => {
  const original = item('1', 'Aquicultura apresenta pesquisa', 1, { url: 'https://revista.test/a' });
  assert.deepEqual(newsTopics([original, { ...original }, { ...original, id: '2', url: 'https://revista.test/a?utm_source=rss#story' }], NOW), []);
});

test('related terms do not fill the whole rail and topics use whole words', () => {
  const topics = newsTopics([
    item('1', 'Inteligência artificial muda pesquisa'), item('2', 'Inteligência artificial na indústria'),
    item('3', 'Salmão no Chile'), item('4', 'Salmão chega ao varejo'),
  ], NOW);
  assert.deepEqual(new Set(topics.map(topic => topic.key)), new Set(['inteligencia artificial', 'salmao']));
  assert.equal(matchesTopic(item('5', 'SalmonChile publica balanço'), 'salmao', NOW), false);
  assert.equal(matchesTopic(item('5', 'Inteligência artificial aplicada à aquicultura'), 'inteligencia artificial', NOW), true);
});

test('a single story or common headline words never manufacture a topic', () => {
  assert.deepEqual(newsTopics([], NOW), []);
  assert.deepEqual(newsTopics([item('1', 'Aquicultura e aquicultura')], NOW), []);
  assert.deepEqual(newsTopics([item('1', 'Novas para hoje'), item('2', 'Hoje anuncia novas')], NOW), []);
});
