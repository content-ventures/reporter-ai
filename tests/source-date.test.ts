import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateEditorialCommandInput } from '../src/server/editorial.ts';
import { scopeForRpc } from '../src/server/editorial-scope.ts';

test('the source-date RPC requires explicit values and scopes the mutation to its source and every user', () => {
  for (const args of [['source-id', '2026-05-20', null], ['source-id', null, '2026-05-20']])
    assert.doesNotThrow(() => validateEditorialCommandInput('updateSourceRecordedOn', args));
  for (const args of [['source-id'], ['source-id', null], ['source-id', {}, null], ['source-id', null, null, { title: 'injected' }]])
    assert.throws(() => validateEditorialCommandInput('updateSourceRecordedOn', args));
  assert.deepEqual(scopeForRpc('updateSourceRecordedOn', ['source-id', null, '2026-05-20']), {
    sources: ['source-id'], sourceUsers: ['source-id'], pipelines: false,
  });
});
