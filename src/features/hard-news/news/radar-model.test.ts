import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NewsFeed, NewsItem } from '../../../domain/hard-news.ts';
import { decidedOf, feedRows, heroOf, hourly, pulse, queueOf, returnLabel, sinceLabel, spread, wireGroups } from './radar-model.ts';

const NOW = new Date(2026, 9, 17, 15, 30).getTime();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function news(id: string, minutes: number, score: number | undefined, patch: Partial<NewsItem> = {}): NewsItem {
  return {
    id, title: `Notícia ${id}`, url: `https://exemplo.test/${id}`, source: 'Agência Litoral', via: 'rss',
    publishedAt: ago(minutes + 2), importedAt: ago(minutes), excerpt: '', body: [], duplicates: [], status: 'new',
    classification: score === undefined ? undefined : { score, topic: 'Pesca', summary: '', reasons: [], mapVersion: 4 },
    ...patch,
  };
}

const ITEMS: NewsItem[] = [
  news('a', 5, 93),
  news('b', 30, 91),
  news('c', 50, 88),
  news('d', 70, 84),
  news('e', 200, 60),
  news('f', 300, undefined),
  news('g', 1_000, 40),
  news('h', 3_000, 20),
  news('x', 100, 70, { status: 'covered', decidedAt: ago(20) }),
  news('y', 400, 30, { status: 'discarded', decidedAt: ago(390) }),
];

test('hero takes the best high-priority stories and the wire never repeats them', () => {
  const queue = queueOf(ITEMS, '');
  const { hero, overflow } = heroOf(queue, 3);
  assert.deepEqual(hero.map((item) => item.id), ['a', 'b', 'c']);
  assert.equal(overflow, 1);
  const rest = queue.filter((item) => !hero.includes(item));
  const groups = wireGroups(rest, ago(60), NOW);
  const ids = groups.flatMap((group) => group.items.map((item) => item.id));
  assert.ok(ids.every((id) => !hero.some((item) => item.id === id)));
  assert.equal(ids.length, rest.length);
});

test('wire groups go from new to older, by arrival', () => {
  const groups = wireGroups(queueOf(ITEMS, ''), ago(40), NOW);
  assert.deepEqual(groups.map((group) => group.id), ['new', 'hour', 'today', 'yesterday', 'older']);
  assert.deepEqual(groups[0].items.map((item) => item.id), ['a', 'b']);
  assert.equal(groups[0].label, 'Novas desde 14:50');
});

test('decided stories read by the latest decision', () => {
  assert.deepEqual(decidedOf(ITEMS, '').map((item) => item.id), ['x', 'y']);
});

test('pulse counts the fresh, the waiting high-priority and the sources', () => {
  const feeds: NewsFeed[] = [
    { id: '1', name: 'A', url: '', everyMinutes: 15, state: 'active', lastDay: 1 },
    { id: '2', name: 'B', url: '', everyMinutes: 15, state: 'failing', lastDay: 0 },
  ];
  const result = pulse([...ITEMS, news('old', 200, 80)], feeds, ago(40), NOW);
  assert.equal(result.fresh.count, 2);
  assert.equal(result.fresh.newestId, 'a');
  assert.equal(result.high.count, 5);
  assert.equal(result.high.oldestId, 'old');
  assert.equal(result.high.waitingTooLong, 1);
  assert.deepEqual(result.feeds, { active: 1, total: 2, failing: 1 });
});

test('hourly buckets sum the classified arrivals of the last 12 hours', () => {
  const buckets = hourly(ITEMS, NOW);
  assert.equal(buckets.length, 12);
  assert.equal(buckets.at(-1)?.label, '15h');
  const total = buckets.reduce((sum, bucket) => sum + bucket.values.high + bucket.values.medium + bucket.values.low, 0);
  // a–e, x and y; f is still being read; g and h arrived before the window (04:00).
  assert.equal(total, 7);
});

test('sources put the failing feed first', () => {
  const rows = feedRows([
    { id: 'p', name: 'P', url: '', everyMinutes: 15, state: 'paused', lastDay: 0 },
    { id: 'a', name: 'A', url: '', everyMinutes: 15, state: 'active', lastDay: 1, lastReadAt: ago(10) },
    { id: 'f', name: 'F', url: '', everyMinutes: 15, state: 'failing', lastDay: 0 },
    { id: 'b', name: 'B', url: '', everyMinutes: 15, state: 'active', lastDay: 1, lastReadAt: ago(2) },
  ]);
  assert.deepEqual(rows.map((feed) => feed.id), ['f', 'b', 'a', 'p']);
});

test('labels for since, return and spread', () => {
  assert.equal(sinceLabel(ago(60), NOW), 'desde 14:30');
  assert.equal(sinceLabel(ago(60 * 20), NOW), 'desde ontem, 19:30');
  assert.equal(returnLabel(new Date(NOW + 40 * 60_000).toISOString(), NOW), 'Volta em 40 min');
  assert.equal(returnLabel(new Date(NOW + 12 * 3_600_000).toISOString(), NOW), 'Volta em 12 h');
  assert.deepEqual(spread({ duplicates: [{ source: 'B', url: '', publishedAt: ago(30) }, { source: 'C', url: '', publishedAt: ago(300) }] }, NOW), { outlets: 3, lastHour: 1 });
});
