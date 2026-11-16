import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateEditorialCommandInput } from '../src/server/editorial.ts';
import type { ArticleBody } from '../src/domain/article.ts';

const table: ArticleBody = { type: 'article', title: 'Source-backed table', blocks: [{ id: 'table', type: 'table', rows: [
  [[{ text: 'Factor' }], [{ text: 'Observation' }]],
  [[{ text: 'Standardization' }], [{ text: 'Confirmed in the supplied source' }]],
] }] };

test('the server accepts article tables, including empty cells while editing', () => {
  for (const body of [table, { ...table, blocks: [{ id: 'new-table', type: 'table', rows: [[[ { text: 'Column 1' } ], [{ text: 'Column 2' }]], [[], []]] }] } as ArticleBody]) {
    assert.doesNotThrow(() => validateEditorialCommandInput('saveDraft', ['article', body, 0]));
  }
});

test('the server rejects malformed or unbounded table payloads before saving', () => {
  for (const rows of [undefined, [], [[]], [[[ { text: 42 } ]]], [[[{ text: 'Header' }]], [[], []]],
    [[[{ text: 'x'.repeat(200001) }]]], Array.from({ length: 1001 }, () => [[]])]) {
    const body = { ...table, blocks: [{ id: 'table', type: 'table', rows }] };
    assert.throws(() => validateEditorialCommandInput('saveDraft', ['article', body, 0]));
  }
});
