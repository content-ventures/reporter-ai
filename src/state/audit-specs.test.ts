import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ChangeNotice } from '../ports/common.ts';
import { auditEventQuery, auditQuery, touchesAudit } from './audit-specs.ts';

const notice = (overrides: Partial<ChangeNotice> = {}): ChangeNotice => ({ scope: 'productions', productionIds: [], activity: [], ...overrides });

describe('audit query specs', () => {
  it('keys are stable for equal filters and distinct per page and event', () => {
    assert.equal(auditQuery({ results: ['denied'], sort: 'newest' }).key, auditQuery({ sort: 'newest', results: ['denied'] }).key);
    assert.notEqual(auditQuery({}, { page: 1 }).key, auditQuery({}, { page: 2 }).key);
    assert.notEqual(auditEventQuery('aud-1').key, auditEventQuery('aud-2').key);
  });

  it('the trail refetches for semantic changes, record updates, sessions, resets and its own notices only', () => {
    assert.equal(touchesAudit(notice({ scope: 'audit' })), true);
    assert.equal(touchesAudit(notice({ scope: 'session' })), true);
    assert.equal(touchesAudit(notice({ scope: 'reset' })), true);
    assert.equal(touchesAudit(notice({ scope: 'external' })), true, 'another tab saved');
    assert.equal(touchesAudit(notice({ scope: 'productions' })), true, 'renames log no activity');
    assert.equal(touchesAudit(notice({ scope: 'runs', activity: ['run.completed'] })), true);
    assert.equal(touchesAudit(notice({ scope: 'runs' })), false, 'streaming deltas');
    assert.equal(touchesAudit(notice({ scope: 'assets' })), false);
    assert.equal(touchesAudit(notice({ scope: 'feedback' })), false);
  });
});
