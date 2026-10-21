import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NewsFeed } from './hard-news.ts';
import { matchesSourceTier, sourceForNews } from './news-source-match.ts';

const feed: NewsFeed = { id: 'publisher', name: 'Publicação', url: 'https://journal.example/feed', kind: 'rss',
  state: 'active', everyMinutes: 60, lastDay: 0, rating: { tier: 'A1', relevance: 'high', rationale: 'Pesquisa original.', updatedAt: '2026-10-21T15:00:00Z' } };

test('source ratings follow the exact publisher, including pasted links and its www alias', () => {
  assert.equal(sourceForNews({ feedId: feed.id, url: 'https://www.journal.example/story' }, [feed]), feed);
  assert.equal(sourceForNews({ url: 'https://journal.example/manual' }, [feed]), feed);
  assert.equal(sourceForNews({ feedId: feed.id, url: 'https://elsewhere.example/story' }, [feed]), undefined);
  assert.equal(sourceForNews({ url: 'https://journal.example.evil.test/story' }, [feed]), undefined);
  assert.equal(sourceForNews({ url: 'invalid' }, [feed]), undefined);
  assert.equal(sourceForNews({ url: 'file://journal.example/story' }, [feed]), undefined);
  const general = { ...feed, id: 'general', rating: undefined };
  assert.equal(sourceForNews({ feedId: general.id, url: 'https://journal.example/story' }, [general, feed]), feed);
});

test('alerts cannot lend their rating; the actual publisher can independently be assessed', () => {
  const alert = { ...feed, id: 'alert', kind: 'google-alerts' as const, keyword: 'pescado' };
  const item = { feedId: alert.id, url: 'https://journal.example/story' };
  assert.equal(sourceForNews(item, [alert]), undefined);
  assert.equal(sourceForNews(item, [alert, feed]), feed);
  assert.equal(sourceForNews(item, [{ ...alert, kind: 'rss-app' }]), undefined);
  const generated = { ...feed, kind: 'rss-app' as const, url: 'https://rss.app/feed', site: 'https://journal.example' };
  assert.equal(sourceForNews(item, [generated]), generated);
});

test('tier filters preserve unrated stories without assigning a low grade or changing article priority', () => {
  const item = { feedId: feed.id, url: 'https://journal.example/story' };
  assert.equal(matchesSourceTier(item, [feed], 'A1'), true);
  assert.equal(matchesSourceTier(item, [feed], 'A2'), false);
  assert.equal(matchesSourceTier(item, [], 'unrated'), true);
  assert.equal(matchesSourceTier(item, [], 'C'), false);
  assert.equal(matchesSourceTier(item, [], 'all'), true);
});
