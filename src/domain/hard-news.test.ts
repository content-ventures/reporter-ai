import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { acceptedSources, compareQueue, imageUsable, openFlags, priorityOf, slugify } from './hard-news.ts';
import type { EvidenceFlag, NewsItem, ResearchSource } from './hard-news.ts';

function news(id: string, score: number | undefined, publishedAt: string, correction?: 'high' | 'medium' | 'low'): NewsItem {
  return {
    id, title: id, url: `https://example.test/${id}`, source: 'Fonte', via: 'rss', publishedAt, importedAt: publishedAt,
    excerpt: '', body: [], duplicates: [], status: 'new',
    ...(score === undefined ? {} : {
      classification: {
        score, topic: 'Aquicultura', summary: '', reasons: [], mapVersion: 1,
        ...(correction ? { correction: { priority: correction, by: 'João', at: publishedAt } } : {}),
      },
    }),
  };
}

describe('R2 · Hard News domain', () => {
  test('priority follows the score until a person corrects it (REQ-2.4)', () => {
    assert.equal(priorityOf(news('a', 91, '2026-10-16T10:00:00Z')), 'high');
    assert.equal(priorityOf(news('b', 60, '2026-10-16T10:00:00Z')), 'medium');
    assert.equal(priorityOf(news('c', 20, '2026-10-16T10:00:00Z')), 'low');
    assert.equal(priorityOf(news('d', 91, '2026-10-16T10:00:00Z', 'low')), 'low');
    assert.equal(priorityOf(news('e', undefined, '2026-10-16T10:00:00Z')), undefined);
  });

  test('the queue reads by priority, then score, then recency; items still read go last', () => {
    const queue = [
      news('reading', undefined, '2026-10-16T12:00:00Z'),
      news('medium', 70, '2026-10-16T11:00:00Z'),
      news('high-old', 80, '2026-10-16T08:00:00Z'),
      news('high-top', 92, '2026-10-16T07:00:00Z'),
      news('high-new', 80, '2026-10-16T09:00:00Z'),
    ].sort(compareQueue);
    assert.deepEqual(queue.map((item) => item.id), ['high-top', 'high-new', 'high-old', 'medium', 'reading']);
  });

  test('a slug keeps only plain lowercase words', () => {
    assert.equal(slugify('Exportações de tilápia crescem 38% no 3º trimestre!'), 'exportacoes-de-tilapia-crescem-38-no-3-trimestre');
  });

  test('an image with pending rights or no credit cannot go into an article (REQ-2.9)', () => {
    assert.equal(imageUsable({ license: 'own', credit: 'Acervo do portal' }), true);
    assert.equal(imageUsable({ license: 'pending', credit: 'Acervo do portal' }), false);
    assert.equal(imageUsable({ license: 'agency', credit: ' ' }), false);
  });

  test('only accepted sources feed the draft; only open flags wait for a person', () => {
    const source = (id: string, state: ResearchSource['state']): ResearchSource => ({ id, title: id, url: id, outlet: id, kind: 'press', consultedAt: '', excerpt: '', state });
    assert.deepEqual(acceptedSources({ sources: [source('a', 'accepted'), source('b', 'suggested'), source('c', 'discarded')] }).map((item) => item.id), ['a']);
    const flag = (id: string, state: EvidenceFlag['state']): EvidenceFlag => ({ id, kind: 'unsupported', claim: id, detail: '', state });
    assert.deepEqual(openFlags([flag('a', 'open'), flag('b', 'confirmed'), flag('c', 'fixed')]).map((item) => item.id), ['a']);
  });
});
