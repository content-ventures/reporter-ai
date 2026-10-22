import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NewsFeed, NewsItem } from '../../../domain/hard-news.ts';
import { arrivedAt, decidedOf, decisionGroups, feedRows, heroOf, hourly, hourlyArrivals, hourlyPace, intakePulse, outletShare, pageOf, pulse, queueOf, returnLabel, sinceLabel, spread, whenLabel, wireGroups } from './radar-model.ts';

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

test('inside an arrival group the stories read by publication, the newest first', () => {
  const late = news('late', 10, undefined, { publishedAt: ago(300) });
  const fresh = news('fresh', 30, undefined, { publishedAt: ago(35) });
  const groups = wireGroups([late, fresh], ago(60), NOW);
  assert.deepEqual(groups.map((group) => group.id), ['new']);
  assert.deepEqual(groups[0].items.map((item) => item.id), ['fresh', 'late']);
});

test('decided stories read by the latest decision', () => {
  assert.deepEqual(decidedOf(ITEMS, '').map((item) => item.id), ['x', 'y']);
});

test('decided stories group by decision, selection first, each group keeping its order', () => {
  const decided = decidedOf([
    ...ITEMS,
    news('s1', 30, 50, { status: 'selected', decidedAt: ago(5) }),
    news('l1', 30, 50, { status: 'later', decidedAt: ago(1), laterUntil: ago(-120) }),
    news('s2', 30, 50, { status: 'selected', decidedAt: ago(50) }),
  ], '');
  const groups = decisionGroups(decided);
  assert.deepEqual(groups.map((group) => group.id), ['selected', 'covered', 'later', 'discarded']);
  assert.deepEqual(groups[0].items.map((item) => item.id), ['s1', 's2']);
  assert.equal(groups[0].label, 'Selecionadas para redação');
  assert.deepEqual(decisionGroups([]), []);
});

test('a page takes the first stories across the groups and keeps their labels', () => {
  const groups = wireGroups(queueOf(ITEMS, ''), ago(40), NOW);
  const page = pageOf(groups, 3);
  assert.deepEqual(page.map((group) => group.id), ['new', 'hour']);
  assert.deepEqual(page.flatMap((group) => group.items.map((item) => item.id)), ['a', 'b', 'c']);
  assert.equal(page[0].label, groups[0].label);
  assert.deepEqual(pageOf(groups, 0), []);
  assert.equal(pageOf(groups, 100).flatMap((group) => group.items).length, queueOf(ITEMS, '').length);
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

test('before the triage, arrivals count every story and the strip finds the most spread one', () => {
  const untriaged = [
    news('s1', 10, undefined, { duplicates: [{ source: 'g1', url: 'https://g1.test/1', publishedAt: ago(8) }] }),
    news('s2', 20, undefined, { duplicates: [{ source: 'g1', url: 'https://g1.test/2', publishedAt: ago(15) }, { source: 'Valor', url: 'https://valor.test/2', publishedAt: ago(12) }] }),
    news('s3', 60 * 30, undefined),
    news('s4', 5, undefined, { status: 'discarded' }),
  ];
  const buckets = hourlyArrivals(untriaged, NOW);
  assert.equal(buckets.length, 12);
  assert.equal(buckets.reduce((total, bucket) => total + bucket.values.all, 0), 3, 'the 30-hour-old story is out of the window');
  assert.deepEqual(intakePulse(untriaged, NOW), { lastDay: 2, spread: { count: 2, topId: 's2', outlets: 3 } });
  assert.deepEqual(intakePulse([], NOW), { lastDay: 0, spread: { count: 0, topId: undefined, outlets: 0 } });
});

test('outlets of the day count their stories and the repeats they ran, the busiest first', () => {
  const day = [
    news('o1', 30, undefined, { source: 'AQUA Chile' }),
    news('o2', 90, undefined, { source: 'AQUA Chile', duplicates: [{ source: 'The Fish Site', url: 'https://thefishsite.test/a', publishedAt: ago(60) }] }),
    news('o3', 200, undefined, { source: 'Mundoacuícola' }),
    news('old', 60 * 30, undefined, { source: 'Mundoacuícola' }),
  ];
  const shares = outletShare(day, NOW);
  assert.deepEqual(shares.map((entry) => [entry.label, entry.value]), [['AQUA Chile', 2], ['Mundoacuícola', 1], ['The Fish Site', 1]]);
  assert.equal(shares[0].share, 50);
  assert.equal(outletShare(day, NOW, 1).length, 1);
  assert.deepEqual(outletShare([], NOW), []);
});

test('times read as minutes in the last hour, the clock today, then yesterday and the date', () => {
  assert.equal(whenLabel(ago(0), NOW), 'agora');
  assert.equal(whenLabel(ago(-30), NOW), 'agora', 'a time ahead of the clock is now');
  assert.equal(whenLabel(ago(12), NOW), 'há 12 min');
  assert.equal(whenLabel(ago(75), NOW), '14:15');
  assert.equal(whenLabel(ago(60 * 20), NOW), 'ontem, 19:30');
  assert.equal(whenLabel(ago(60 * 24 * 3), NOW), '14/10');
  assert.equal(whenLabel('invalid', NOW), '');
});

test('the pace counts arrivals in rolling hours, the last hour last, decided stories included', () => {
  const pace = hourlyPace(ITEMS, NOW, 4);
  assert.equal(pace.length, 4);
  // a (5 min), b (30) and c (50) in the last hour; d (70) and x (100) in the hour before.
  assert.deepEqual(pace, [1, 0, 2, 3]);
  assert.deepEqual(hourlyPace([news('future', -30, undefined)], NOW, 2), [0, 0], 'a story from the future has not arrived');
  assert.deepEqual(hourlyPace([], NOW, 3), [0, 0, 0]);
});

test('backlog a new source brings arrives at its publication, a fresh story at its import', () => {
  assert.equal(arrivedAt(news('fresh', 10, undefined)), ago(10));
  const backlog = news('old', 1, undefined, { publishedAt: ago(3 * 24 * 60) });
  assert.equal(arrivedAt(backlog), ago(3 * 24 * 60));
  assert.equal(wireGroups([backlog], ago(90), NOW)[0]?.id, 'older');
  assert.equal(arrivedAt({ ...backlog, returnedAt: ago(2) }), ago(2));
});
