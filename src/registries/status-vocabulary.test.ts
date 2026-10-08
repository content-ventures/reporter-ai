import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PIECE_STATUS_LABELS, PRODUCTION_STATUS_LABELS } from '../domain/rules/status.ts';
import { RUN_STATUS_LABELS } from '../domain/run.ts';
import {
  BANNER_MAX_ACTIONS,
  BANNER_TONE,
  PIECE_STATUS_LOOK,
  PRODUCTION_STATUS_LOOK,
  RUN_STATUS_LOOK,
  type StatusLook,
} from './status-vocabulary.ts';

const looks = (record: Readonly<Record<string, StatusLook>>) => Object.values(record);

test('every piece, production and run status has a look', () => {
  assert.deepEqual(Object.keys(PIECE_STATUS_LOOK).sort(), Object.keys(PIECE_STATUS_LABELS).sort());
  assert.deepEqual(Object.keys(PRODUCTION_STATUS_LOOK).sort(), Object.keys(PRODUCTION_STATUS_LABELS).sort());
  assert.deepEqual(Object.keys(RUN_STATUS_LOOK).sort(), Object.keys(RUN_STATUS_LABELS).sort());
});

test('newsroom tones: violet waits, orange returns, teal approves, amber is outdated, red stops', () => {
  assert.equal(PIECE_STATUS_LOOK.draft.tone, 'gray');
  assert.equal(PIECE_STATUS_LOOK.in_review.tone, 'violet');
  assert.equal(PIECE_STATUS_LOOK.changes_requested.tone, 'orange');
  assert.equal(PIECE_STATUS_LOOK.approved.tone, 'teal');
  assert.equal(PIECE_STATUS_LOOK.approval_outdated.tone, 'amber');
  assert.equal(PIECE_STATUS_LOOK.stale.tone, 'amber');
  assert.equal(PIECE_STATUS_LOOK.failed.tone, 'red');
  assert.equal(PRODUCTION_STATUS_LOOK.unauthorized.tone, 'red');
  assert.equal(PRODUCTION_STATUS_LOOK.completed.tone, 'gray');
});

test('the AI writing is a spinner, inactive states are hollow, and blue is never a status', () => {
  assert.equal(PIECE_STATUS_LOOK.generating.spinner, true);
  assert.equal(PRODUCTION_STATUS_LOOK.generating.spinner, true);
  for (const status of ['locked', 'not_started'] as const) assert.equal(PIECE_STATUS_LOOK[status].dot, 'hollow');
  assert.equal(PRODUCTION_STATUS_LOOK.archived.dot, 'hollow');
  const all = [...looks(PIECE_STATUS_LOOK), ...looks(PRODUCTION_STATUS_LOOK), ...looks(RUN_STATUS_LOOK)];
  assert.ok(all.every((look) => (look.tone as string) !== 'blue'));
  assert.equal(all.filter((look) => look.spinner).every((look) => look.tone === 'gray'), true);
});

test('banner tones and verbs follow the approval flow', () => {
  assert.equal(BANNER_TONE.writing, 'neutral');
  assert.equal(BANNER_TONE.error, 'danger');
  assert.equal(BANNER_TONE.sent, 'info');
  assert.equal(BANNER_TONE.awaiting_you, 'info');
  assert.equal(BANNER_TONE.changes, 'attention');
  assert.equal(BANNER_TONE.approved, 'success');
  assert.equal(BANNER_TONE.approval_outdated, 'warning');
  assert.equal(BANNER_TONE.decided, 'success');
  assert.equal(BANNER_TONE.outdated, 'warning');
  assert.deepEqual(Object.keys(BANNER_MAX_ACTIONS).sort(), Object.keys(BANNER_TONE).sort());
  // One sentence and at most one verb; only "outdated" offers two ways out.
  const twoVerbs = Object.entries(BANNER_MAX_ACTIONS).filter(([, max]) => max > 1).map(([kind]) => kind);
  assert.deepEqual(twoVerbs, ['outdated']);
  assert.equal(BANNER_MAX_ACTIONS.awaiting_you, 0, 'the approver acts through the screen primary, not the banner');
  assert.equal(BANNER_MAX_ACTIONS.approved, 0, 'the next step is the header primary');
});
