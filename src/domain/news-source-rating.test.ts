import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isRateableNewsSource, sourceRatingRank } from './news-source-rating.ts';

test('editorial source order is independent of relevance and leaves unassessed sources last', () => {
  assert.deepEqual(['C', 'A2', 'B', 'A1'].map(tier => ({ tier: tier as 'C' | 'A2' | 'B' | 'A1' }))
    .sort((a, b) => sourceRatingRank(a) - sourceRatingRank(b)).map(rating => rating.tier), ['A1', 'A2', 'B', 'C']);
  assert.equal(sourceRatingRank(undefined), 4);
});

test('only publication feeds can receive an editorial rating', () => {
  for (const source of [{}, { kind: 'rss' }, { kind: 'rss-app' }]) assert.equal(isRateableNewsSource(source), true);
  for (const source of [{ kind: 'google-alerts' }, { kind: 'rss-app', keyword: 'tilápia' }, { kind: 'rss', keyword: 'pescado' }]) {
    assert.equal(isRateableNewsSource(source), false);
  }
});
