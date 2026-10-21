import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { decideNewsItem } from '../src/server/news-decisions.ts';
import type { NewsDecisionInput } from '../src/domain/news-decisions.ts';

const ID = '0c2b3d4e-5f60-4718-8a9b-0c1d2e3f4a5b';

describe('news decision endpoint', () => {
  test('rejects invalid decisions before writing and trims a valid discard reason', async () => {
    const calls: NewsDecisionInput[] = [];
    const deps = { write: async (_id: string, decision: NewsDecisionInput) => {
      calls.push(decision);
      return {
        id: ID, via: 'rss' as const, url: 'https://portal.exemplo/noticia', title: 'Notícia', outlet: 'Portal',
        excerpt: 'Trecho', body: ['Texto original completo'], paragraphs: 1, duplicates: [],
        publishedAt: '2026-10-21T12:00:00Z', importedAt: '2026-10-21T12:01:00Z',
        status: 'discarded' as const, decisionRevision: 8, decidedBy: 'Editor', decidedAt: '2026-10-21T12:05:00Z',
        discardReason: decision.action === 'discard' ? decision.reason : undefined,
      };
    } };
    for (const input of [
      { action: 'select' }, { action: 'select', revision: -1 }, { action: 'select', revision: 0, hours: 2 },
      { action: 'postpone', revision: 0, hours: 0 }, { action: 'postpone', revision: 0, hours: 721 },
      { action: 'discard', revision: 0, reason: ' ' }, { action: 'discard', revision: 0, reason: 'a'.repeat(501) },
    ]) await assert.rejects(decideNewsItem(ID, input, deps), { code: 'NEWS_DECISION_INVALID', status: 422 });
    await assert.rejects(decideNewsItem('not-an-id', { action: 'select', revision: 0 }, deps), { code: 'NEWS_DECISION_INVALID', status: 422 });
    assert.equal(calls.length, 0);
    const result = await decideNewsItem(ID, { action: 'discard', revision: 7, reason: ' Fora do foco ' }, deps);
    assert.deepEqual(calls, [{ action: 'discard', revision: 7, reason: 'Fora do foco' }]);
    assert.equal(result.status, 'discarded');
    assert.equal(result.decisionRevision, 8);
    assert.equal(result.decidedBy, 'Editor');
    assert.equal(result.discardReason, 'Fora do foco');
    assert.deepEqual(result.body, ['Texto original completo']);
  });

  test('reports stale decisions as conflict, missing material as not found and readers as forbidden', async () => {
    for (const [message, status, code] of [
      ['NEWS_DECISION_CONFLICT', 409, 'NEWS_DECISION_CONFLICT'],
      ['NEWS_ITEM_NOT_FOUND', 404, 'NEWS_ITEM_NOT_FOUND'],
      ['NEWS_DECISION_INVALID', 422, 'NEWS_DECISION_INVALID'],
      ['Reporter action denied', 403, 'FORBIDDEN'],
    ] as const) {
      const failure = Object.assign(new Error(message), { code: message === 'Reporter action denied' ? '42501' : '40001' });
      await assert.rejects(decideNewsItem(ID, { action: 'select', revision: 0 }, {
        write: async () => { throw failure; },
      }), { code, status });
    }
  });
});
