import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { SourcePatch } from '../src/ports/news-intake.ts';
import { feedView, updateSource } from '../src/server/news-intake.ts';
import { FlowError } from '../src/server/errors.ts';

const source = { id: '6b1f8a8e-2f7c-4d55-9a51-6f0f3f8d7a10', kind: 'rss' as const, name: 'Instituto',
  url: 'https://instituto.exemplo/feed', everyMinutes: 60, paused: false, failures: 0 };
const rating = { tier: 'A1' as const, relevance: 'high' as const, rationale: 'Publica pesquisa própria sobre o setor.' };

describe('editorial source ratings', () => {
  test('trims input, preserves explicit clearing versus an omitted rating, and returns the saved timestamp', async () => {
    const patches: SourcePatch[] = [];
    const saved = { ...source, rating: { ...rating, updatedAt: '2026-10-21T12:00:00+00:00' } };
    const deps = { requireEdit: async () => {}, source: async () => source,
      write: async (_id: string, patch: SourcePatch) => { patches.push(patch); return saved; } };
    const result = await updateSource(source.id, { rating: { ...rating, rationale: `  ${rating.rationale}\n` } }, deps);
    assert.deepEqual(patches[0], { rating });
    assert.deepEqual(result.rating, { ...rating, updatedAt: '2026-10-21T12:00:00.000Z' });
    await updateSource(source.id, { rating: null }, deps);
    await updateSource(source.id, { paused: true }, deps);
    assert.deepEqual(patches.slice(1), [{ rating: null }, { paused: true }]);
    assert.equal(Object.hasOwn(feedView(source), 'rating'), false, 'activity never creates a rating');
  });

  test('rejects malformed, partial and server-owned fields before reading or writing a source', async () => {
    const unexpected = async (): Promise<never> => { throw new Error('Invalid input reached persistence'); };
    const deps = { requireEdit: async () => {}, source: unexpected, write: unexpected };
    for (const value of [
      { rating: {} }, { rating: [] }, { rating: 'A1' }, { rating: { ...rating, tier: 'A' } },
      { rating: { ...rating, relevance: 'urgent' } }, { rating: { ...rating, rationale: ' \n\t' } },
      { rating: { ...rating, rationale: 'x'.repeat(601) } }, { rating: { ...rating, rationale: 1 } },
      { rating: { ...rating, updatedAt: '2026-10-21T12:00:00Z' } }, { rating, inferred: true },
    ]) await assert.rejects(updateSource(source.id, value, deps), { code: 'INVALID_INPUT', status: 422 });
    await assert.rejects(updateSource('bad-id', { rating }, deps), { code: 'INVALID_INPUT', status: 422 });
  });

  test('refuses readers before retrieval and refuses aggregator ratings while allowing clearing', async () => {
    const unexpected = async (): Promise<never> => { throw new Error('Unexpected persistence'); };
    await assert.rejects(updateSource(source.id, { rating }, {
      requireEdit: async () => { throw new FlowError('FORBIDDEN', 403); }, source: unexpected, write: unexpected,
    }), { code: 'FORBIDDEN', status: 403 });
    for (const aggregator of [{ ...source, kind: 'google-alerts' as const }, { ...source, kind: 'rss-app' as const, keyword: 'pescado' }]) {
      await assert.rejects(updateSource(source.id, { rating }, {
        requireEdit: async () => {}, source: async () => aggregator, write: unexpected,
      }), { code: 'NEWS_SOURCE_RATING_UNSUPPORTED', status: 422 });
      const result = await updateSource(source.id, { rating: null }, {
        requireEdit: async () => {}, source: unexpected, write: async () => aggregator,
      });
      assert.equal(result.rating, undefined);
    }
  });
});
