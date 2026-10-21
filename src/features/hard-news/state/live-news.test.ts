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
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test('a list update keeps a text already read and adds the new items', () => {
  const read = item('a', { body: ['Lead', 'Dois', 'Três'], paragraphs: undefined });
  const merged = mergeItems([read], [item('a', { title: 'a novo' }), item('b')]);
  assert.deepEqual(merged.map((entry) => [entry.id, entry.title, entry.body.length]), [['a', 'a novo', 3], ['b', 'b', 1]]);
});

test('a translation arriving by poll invalidates the cached original and rejects a late original detail', () => {
  const original = item('a', { title: 'Fish exports rise', excerpt: 'Original lead', body: ['Original text'],
    paragraphs: undefined, updatedAt: '2026-10-21T12:00:00.000Z', translation: { status: 'pending', targetLanguage: 'pt-BR' } });
  const translated = item('a', { title: 'Exportações de peixe crescem', excerpt: 'Lead traduzido', body: ['Lead traduzido'],
    updatedAt: '2026-10-21T12:01:00.000Z', translation: { status: 'translated', sourceLanguage: 'en', targetLanguage: 'pt-BR' } });
  const polled = mergeItems([original], [translated])[0];
  assert.equal(polled.paragraphs, 3);
  assert.deepEqual(polled.body, ['Lead traduzido']);
  const late = mergeItems([polled], [original])[0];
  assert.equal(late.title, translated.title);
  assert.equal(late.paragraphs, 3);
  assert.deepEqual(late.body, ['Lead traduzido']);
  const read = { ...translated, body: ['Texto traduzido completo'], paragraphs: undefined };
  assert.deepEqual(mergeItems([read], [translated])[0].body, read.body);
});

test('a body load waits for the translated detail when its original request loses a race with polling', async () => {
  const old = deferred<NewsItem>();
  const original = item('a', { title: 'English title', updatedAt: '2026-10-21T12:00:00.000Z',
    translation: { status: 'pending', targetLanguage: 'pt-BR' } });
  const translated = item('a', { title: 'Título traduzido', updatedAt: '2026-10-21T12:01:00.000Z',
    translation: { status: 'translated', targetLanguage: 'pt-BR', sourceLanguage: 'en' } });
  let reads = 0;
  const store = createLiveNewsStore({ item: async () => ++reads === 1 ? old.promise
    : { ...translated, body: ['Texto traduzido'], paragraphs: undefined } } as unknown as NewsIntake);
  store.putItem(original);
  const loading = store.loadBody('a');
  store.putItem(translated);
  old.resolve({ ...original, body: ['English body'], paragraphs: undefined });
  await loading;
  assert.equal(reads, 2);
  assert.deepEqual(store.get().news[0].body, ['Texto traduzido']);
  assert.equal(store.get().news[0].paragraphs, undefined);
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

test('a stale poll cannot undo source removal, update or creation; a later read can reconcile them', async () => {
  const stale = deferred<NewsSnapshot>();
  const updated = { ...feed('updated'), name: 'Renamed source', state: 'paused' as const };
  const added = feed('added');
  let calls = 0;
  const store = createLiveNewsStore({ read: () => {
    calls++;
    return calls === 1 ? stale.promise : Promise.resolve({ at: '2026-10-19T12:01:00Z',
      sources: calls === 2 ? [updated, added] : [{ ...updated, name: 'Changed in another session' }], items: [], rssApp: false });
  } } as unknown as NewsIntake);
  store.putFeed(feed('removed'));
  store.putFeed(feed('updated'));
  const polling = store.refresh();
  store.dropFeed('removed');
  store.putFeed(updated);
  store.putFeed(added);
  stale.resolve({ at: '2026-10-19T12:00:00Z', sources: [feed('removed'), feed('updated')], items: [], rssApp: false });
  await polling;
  assert.deepEqual(store.get().feeds, [updated, added]);
  await store.refresh();
  assert.deepEqual(store.get().feeds, [updated, added]);
  await store.refresh();
  assert.deepEqual(store.get().feeds, [{ ...updated, name: 'Changed in another session' }]);
});

test('refreshes during a poll coalesce into a fresh read and await the new source collection', async () => {
  const old = deferred<NewsSnapshot>(), fresh = deferred<NewsSnapshot>(), started = deferred<void>();
  const calls: (string | undefined)[] = [];
  const store = createLiveNewsStore({ read: (since?: string) => {
    calls.push(since);
    if (calls.length === 1) return old.promise;
    started.resolve();
    return fresh.promise;
  } } as unknown as NewsIntake);
  const polling = store.refresh();
  store.putFeed(feed('added'));
  const afterCreation = store.refresh();
  assert.equal(afterCreation, polling);
  assert.equal(store.refresh(), polling);
  let finished = false;
  void afterCreation.then(() => { finished = true; });
  old.resolve({ at: '2026-10-19T12:00:00Z', sources: [], items: [], rssApp: false });
  await started.promise;
  assert.equal(finished, false);
  assert.deepEqual(store.get().feeds, [feed('added')]);
  fresh.resolve({ at: '2026-10-19T12:01:00Z', sources: [feed('added')], items: [item('first-collection')], rssApp: false });
  await afterCreation;
  assert.equal(finished, true);
  assert.deepEqual(calls, [undefined, '2026-10-19T11:59:00.000Z']);
  assert.equal(store.get().news[0].id, 'first-collection');
});

test('a queued refresh retries a failed poll before its callers finish', async () => {
  const first = deferred<NewsSnapshot>();
  let calls = 0;
  const store = createLiveNewsStore({ read: () => ++calls === 1 ? first.promise
    : Promise.resolve({ at: '2026-10-19T12:00:00Z', items: [item('recovered')], rssApp: false }) } as unknown as NewsIntake);
  const polling = store.refresh();
  const retrying = store.refresh();
  first.reject(new Error('offline'));
  await Promise.all([polling, retrying]);
  assert.equal(calls, 2);
  assert.equal(store.get().failed, false);
  assert.equal(store.get().news[0].id, 'recovered');
});

test('single-paragraph text loads once, survives polling and opens outside the snapshot window', async () => {
  let reads = 0;
  const full = item('old', { body: ['The entire long paragraph, beyond its lead.'], paragraphs: undefined });
  const port = {
    item: async () => { reads += 1; return full; },
    read: async () => ({ at: '2026-10-19T12:00:00Z', items: [item('old', { paragraphs: 1 })], rssApp: false }),
  } as unknown as NewsIntake;
  const store = createLiveNewsStore(port);
  await store.loadBody('old');
  await store.refresh();
  await store.loadBody('old');
  assert.equal(reads, 1);
  assert.deepEqual(store.get().news[0].body, full.body);
  assert.equal(store.get().news[0].paragraphs, undefined);
});

test('concurrent body callers wait for the result without overwriting a later decision', async () => {
  let complete!: (value: NewsItem) => void;
  const pending = new Promise<NewsItem>(resolve => { complete = resolve; });
  const store = createLiveNewsStore({ item: () => pending } as unknown as NewsIntake);
  const one = store.loadBody('a');
  let secondDone = false;
  const two = store.loadBody('a').then(() => { secondDone = true; });
  await Promise.resolve();
  assert.equal(secondDone, false);
  store.putItem(item('a', { status: 'selected', decisionRevision: 1 }));
  complete(item('a', { decisionRevision: 0, body: ['Original full text.'], paragraphs: undefined }));
  await Promise.all([one, two]);
  assert.equal(store.get().news[0].status, 'selected');
  assert.deepEqual(store.get().news[0].body, ['Original full text.']);
});

test('missing detail remains retryable and does not fabricate a news item', async () => {
  let reads = 0;
  const store = createLiveNewsStore({ item: async () => ++reads === 1 ? undefined : item('a') } as unknown as NewsIntake);
  await assert.rejects(store.loadBody('a'), /disponível/);
  assert.equal(store.get().news.length, 0);
  await store.loadBody('a');
  assert.equal(store.get().news[0].id, 'a');
});

test('drains every page before advancing the poll and retries a failed page without losing the window', async () => {
  const next = { updatedAt: '2026-10-19T11:59:02.123456Z', id: '400', until: '2026-10-19T12:00:00.654321Z' };
  const calls: unknown[] = [];
  let fail = true;
  const port = { read: async (since?: string, page?: typeof next): Promise<NewsSnapshot> => {
    calls.push({ since, page });
    if (page && fail) { fail = false; throw new Error('offline'); }
    return { at: next.until, items: [item(page ? 'retained-selection' : 'latest')], rssApp: false, ...(page ? {} : { next }) };
  } } as unknown as NewsIntake;
  const store = createLiveNewsStore(port);
  await store.refresh();
  assert.equal(store.get().failed, true);
  await store.refresh();
  assert.equal(store.get().failed, false);
  assert.deepEqual(store.get().news.map(value => value.id), ['latest', 'retained-selection']);
  assert.deepEqual(calls, [{ since: undefined, page: undefined }, { since: undefined, page: next },
    { since: undefined, page: undefined }, { since: undefined, page: next }]);
  await store.refresh();
  assert.equal((calls[4] as unknown as { since: string }).since, '2026-10-19T11:59:00.654Z');
});


test('enriched content invalidates a loaded body even when the language has not changed', () => {
  const old = item('one', { body: ['Old RSS summary'], paragraphs: undefined, contentRevision: 0, updatedAt: '2026-10-21T10:00:00Z' });
  const enriched = item('one', { body: ['New lead'], paragraphs: 10, contentRevision: 1, updatedAt: '2026-10-21T10:01:00Z' });
  const [current] = mergeItems([old], [enriched]);
  assert.equal(current.paragraphs, 10);
  assert.deepEqual(current.body, ['New lead']);
  assert.deepEqual(mergeItems([current], [old])[0], current, 'a late old detail cannot restore the previous body');
});
