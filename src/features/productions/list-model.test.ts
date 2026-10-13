import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { situationStatus, sortAfterHeaderClick, tableSort, visibleTabs } from './list-model.ts';

const TABS = ['all', 'editing', 'in_review', 'changes_requested', 'approved', 'completed', 'archived'] as const;

describe('Produções table rules', () => {
  it('hides empty tabs except "Todas" and the one on screen', () => {
    const counts = { all: 9, editing: 5, in_review: 2, changes_requested: 1, approved: 0, completed: 1, archived: 0 };
    assert.deepEqual(visibleTabs(TABS, counts, 'all'), ['all', 'editing', 'in_review', 'changes_requested', 'completed']);
    assert.deepEqual(visibleTabs(TABS, counts, 'approved'), ['all', 'editing', 'in_review', 'changes_requested', 'approved', 'completed']);
    assert.deepEqual(visibleTabs(TABS, { ...counts, all: 0, editing: 0, in_review: 0, changes_requested: 0, completed: 0 }, 'all'), ['all']);
  });

  it('shows only "Todas" and the active tab while the counts load', () => {
    assert.deepEqual(visibleTabs(TABS, undefined, 'all'), ['all']);
    assert.deepEqual(visibleTabs(TABS, undefined, 'in_review'), ['all', 'in_review']);
  });

  it('draws a situation with the piece badge, or the production one for production-only states', () => {
    assert.deepEqual(situationStatus({ status: 'in_review' }), { kind: 'piece', status: 'in_review' });
    assert.deepEqual(situationStatus({ status: 'approval_outdated' }), { kind: 'piece', status: 'approval_outdated' });
    assert.deepEqual(situationStatus({ status: 'unauthorized' }), { kind: 'production', status: 'unauthorized' });
    assert.deepEqual(situationStatus({ status: 'completed' }), { kind: 'production', status: 'completed' });
    assert.deepEqual(situationStatus({ status: 'archived' }), { kind: 'production', status: 'archived' });
  });

  it('sorts by urgency until "Atualizada" is clicked, then cycles back', () => {
    assert.equal(tableSort('urgency'), undefined);
    assert.deepEqual(tableSort('updated_desc'), { key: 'updated', direction: 'desc' });
    assert.deepEqual(tableSort('updated_asc'), { key: 'updated', direction: 'asc' });
    assert.equal(sortAfterHeaderClick('urgency'), 'updated_desc');
    assert.equal(sortAfterHeaderClick('updated_desc'), 'updated_asc');
    assert.equal(sortAfterHeaderClick('updated_asc'), 'urgency');
  });
});
