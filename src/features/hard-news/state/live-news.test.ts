import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NewsFeed, NewsItem } from '../../../domain/hard-news.ts';
import type { NewsIntake, NewsSnapshot } from '../../../ports/news-intake.ts';
import { createLiveNewsStore, mergeItems } from './live-news.ts';

const item = (id: string, patch: Partial<NewsItem> = {}): NewsItem => ({
  id, title: id, url: `https://a.test/${id}`, source: 'A', via: 'rss', publishedAt: '2026-10-19T10:00:00.000Z',
  importedAt: '2026-10-19T10:01:00.000Z', excerpt: 'Lead', body: ['Lead'], paragraphs: 3, duplicates: [], status: 'new', ...patch,
});
const feed = (id: string): NewsFeed => ({ id, name: id, url: `https://a.test/${id}.xml`, everyMinutes: 60, state: 'active', lastDay: 0 });

test('a list update keeps a text already read and adds the new items', () => {
  const read = item('a', { body: ['Lead', 'Dois', 'Três'], paragraphs: undefined });
  const merged = mergeItems([read], [item('a', { title: 'a novo' }), item('b')]);
  assert.deepEqual(merged.map((entry) => [entry.id, entry.title, entry.body.length]), [['a', 'a novo', 3], ['b', 'b', 1]]);
});

test('polls from a minute before the last answer, keeps sources when unchanged, reads a text once', async () => {
  const calls: (string | undefined)[] = [];
  const answers: NewsSnapshot[] = [
    { at: '2026-10-19T12:00:00.000Z', sources: [feed('f1')], items: [item('a')], rssApp: true },
    { at: '2026-10-19T12:01:00.000Z', items: [item('b')], rssApp: true },
  ];
  let reads = 0;
  const port = {
    read: async (since?: string) => { calls.push(since); return answers[calls.length - 1]!; },
    item: async (id: string) => { reads += 1; return item(id, { body: ['Lead', 'Dois', 'Três'], paragraphs: undefined }); },
  } as unknown as NewsIntake;
  const store = createLiveNewsStore(port);
  await store.refresh();
  await store.refresh();
  assert.deepEqual(calls, [undefined, '2026-10-19T11:59:00.000Z']);
  assert.deepEqual(store.get().feeds.map((entry) => entry.id), ['f1']);
  assert.deepEqual(store.get().news.map((entry) => entry.id), ['a', 'b']);
  assert.equal(store.get().rssApp, true);
  await Promise.all([store.loadBody('a'), store.loadBody('a')]);
  await store.loadBody('a');
  assert.equal(reads, 1);
  assert.equal(store.get().news.find((entry) => entry.id === 'a')?.body.length, 3);
});

test('a failed poll keeps what is on screen', async () => {
  const port = { read: async () => { throw new Error('offline'); } } as unknown as NewsIntake;
  const store = createLiveNewsStore(port);
  store.putFeed(feed('f1'));
  await store.refresh();
  assert.equal(store.get().failed, true);
  assert.equal(store.get().ready, true);
  assert.deepEqual(store.get().feeds.map((entry) => entry.id), ['f1']);
});
