import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { memoryStorage } from '../adapters/local/store/index.ts';
import { createRunLeases, DEFAULT_GRACE_MS, DEFAULT_STALE_MS, LEASE_PREFIX } from './run-leases.ts';

/** A04 · which tab drives each live run, so a reload or a new tab never interrupts one. */
describe('run leases', () => {
  const setup = () => {
    const storage = memoryStorage();
    let wall = 1_000_000;
    const now = () => wall;
    return {
      storage,
      advance: (ms: number) => (wall += ms),
      tab: (tab: string) => createRunLeases({ storage, tab, now }),
    };
  };

  it('a run another tab renews is not free; once its lease goes stale, it is', () => {
    const { tab, advance } = setup();
    const a = tab('tab-a');
    const b = tab('tab-b');
    a.beat(['run-1']);
    assert.equal(b.free('run-1'), false);
    assert.equal(b.claim('run-1')(), false, 'a claim on a held run never wins');
    advance(DEFAULT_STALE_MS - 1);
    assert.equal(b.free('run-1'), false);
    advance(2);
    assert.equal(b.free('run-1'), true, 'the tab froze or closed without saying');
  });

  it('a tab that leaves (reload, close) gives its runs up after the grace; the same tab takes them back at once', () => {
    const { tab, advance } = setup();
    const first = tab('tab-a');
    first.beat(['run-1']);
    first.leave();
    const reloaded = tab('tab-a');
    assert.equal(reloaded.free('run-1'), true, 'its own run, after a reload');
    const other = tab('tab-b');
    assert.equal(other.free('run-1'), false);
    advance(DEFAULT_GRACE_MS + 1);
    assert.equal(other.free('run-1'), true);
  });

  it('a claim holds only if no other tab wrote over it before the confirmation', () => {
    const { tab, storage } = setup();
    const a = tab('tab-a');
    const confirmA = a.claim('run-1');
    assert.equal(tab('tab-b').claim('run-1')(), false, 'a fresh claim is not free for the other tab');
    // Both tabs found the run free at the same moment: the other tab's write lands after ours.
    storage.setItem(`${LEASE_PREFIX}run-1`, JSON.stringify({ tab: 'tab-b', at: 1_000_000 }));
    assert.equal(confirmA(), false, 'this tab backs off; the run is continued once');
  });

  it('a run this tab stops driving loses its lease; the lease of another tab is never removed', () => {
    const { tab, storage } = setup();
    const a = tab('tab-a');
    const b = tab('tab-b');
    a.beat(['run-1', 'run-2']);
    b.beat(['run-3']);
    a.beat(['run-2']);
    assert.equal(storage.getItem(`${LEASE_PREFIX}run-1`), null);
    a.release('run-3');
    assert.ok(storage.getItem(`${LEASE_PREFIX}run-3`));
    a.release('run-2');
    assert.equal(storage.getItem(`${LEASE_PREFIX}run-2`), null);
  });
});
