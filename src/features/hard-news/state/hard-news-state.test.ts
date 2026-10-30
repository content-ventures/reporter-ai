import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NewsItem } from '../../../domain/hard-news.ts';
import { coveredToday, initialState, migrate, rebase } from './hard-news-state.ts';

const NOW = Date.parse('2026-10-17T15:00:00.000Z');
const HOUR = 3_600_000;

test('migrate adds the newer example articles and keeps the stored ones as they are', () => {
  const stored = initialState(NOW - 5 * HOUR);
  const old = stored.archive.filter((article) => !article.id.startsWith('a-shrimp-price') && !['a-us-fillet', 'a-feed', 'a-sardine', 'a-sif'].includes(article.id));
  const changed = { ...stored, archive: old.map((article) => (article.id === 'a-fair' ? { ...article, index: 'pending' as const } : article)) };
  const next = migrate(changed, NOW);
  assert.equal(next.archive.length, stored.archive.length);
  assert.equal(next.archive.find((article) => article.id === 'a-fair')?.index, 'pending');
  assert.ok(next.archive.some((article) => article.id === 'a-sif'));
});

test('migrate fills the desk question when missing and keeps an existing one', () => {
  const stored = initialState(NOW - HOUR);
  const missing = migrate({ ...stored, lastAsk: undefined }, NOW);
  assert.equal(missing.lastAsk?.question, 'O que já publicamos sobre exportação de tilápia?');
  const kept = migrate({ ...stored, lastAsk: { ...stored.lastAsk!, question: 'Outra pergunta' } }, NOW);
  assert.equal(kept.lastAsk?.question, 'Outra pergunta');
});

test('rebase moves the question time with the rest of the desk', () => {
  const stored = initialState(NOW - 10 * HOUR);
  const before = Date.parse(stored.lastAsk!.askedAt);
  const moved = rebase(stored, NOW);
  const shift = Date.parse(moved.lastAsk!.askedAt) - before;
  // Ten hours away, minus the 20 minutes the example pretends the person was gone.
  assert.equal(shift, 10 * HOUR - 20 * 60_000);
});

test('today counts connected production links, honors local midnight and has no daily cap', () => {
  const story = initialState(NOW).news[0];
  const today = new Date(NOW);
  today.setHours(0, 0, 0, 0);
  const linked: NewsItem[] = Array.from({ length: 31 }, (_, index) => ({
    ...story, id: `covered-${index}`, status: 'covered', coveredAt: new Date(today.getTime() + index * 60_000).toISOString(),
  }));
  const yesterday: NewsItem = { ...story, id: 'covered-yesterday', status: 'covered', coveredAt: new Date(today.getTime() - HOUR).toISOString() };
  const selected: NewsItem = { ...story, id: 'selected-today', status: 'selected', decidedAt: new Date(today.getTime() + HOUR).toISOString() };
  assert.equal(coveredToday([...linked, yesterday, selected], NOW), 31);
});
