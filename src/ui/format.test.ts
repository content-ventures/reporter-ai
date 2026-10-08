import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatListDateTime } from './format.ts';

test('list date and time stay on one line: the dot is held by non-breaking spaces', () => {
  const text = formatListDateTime(new Date(2026, 8, 29, 1, 30));
  assert.equal(text, '29/09 · 01:30');
  assert.doesNotMatch(text, / /);
  assert.equal(formatListDateTime('not a date'), '—');
});
