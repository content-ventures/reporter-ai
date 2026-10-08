import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ok, refuse } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { ChangeNotice } from '../ports/common.ts';
import { createQueryStore } from './query-store.ts';
import type { QuerySpec, Scheduler } from './query-store.ts';
import { UNEXPECTED_ERROR } from './query-state.ts';

type Source = { value: number; fail?: 'refuse' | 'throw'; calls: number };

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function changes() {
  const listeners = new Set<(notice: ChangeNotice) => void>();
  return {
    subscribe: (listener: (notice: ChangeNotice) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: (notice: Partial<ChangeNotice> = {}) => {
      for (const listener of listeners) listener({ scope: 'productions', productionIds: [], activity: [], ...notice });
    },
    size: () => listeners.size,
  };
}

function manualScheduler() {
  const tasks: { task: () => void; cancelled: boolean }[] = [];
  const schedule: Scheduler = (task) => {
    const entry = { task, cancelled: false };
    tasks.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  return { schedule, runAll: () => tasks.splice(0).forEach((entry) => !entry.cancelled && entry.task()) };
}

const valueSpec = (affected = true): QuerySpec<Source, number> => ({
  key: 'value',
  async fetch(source): Promise<Result<number, string>> {
    source.calls += 1;
    if (source.fail === 'refuse') return refuse('not_found', 'Não encontramos esta produção.');
    if (source.fail === 'throw') throw new Error('boom');
    return ok(source.value);
  },
  affectedBy: () => affected,
});

function setup(options: { affected?: boolean } = {}) {
  const source: Source = { value: 1, calls: 0 };
  const feed = changes();
  const scheduler = manualScheduler();
  const store = createQueryStore(source, feed.subscribe, { schedule: scheduler.schedule });
  const entry = store.entry(valueSpec(options.affected));
  return { source, feed, scheduler, store, entry };
}

describe('createQueryStore', () => {
  it('loads when a screen subscribes and keeps one snapshot object per state', async () => {
    const { source, entry, store } = setup();
    assert.equal(entry.snapshot().status, 'loading');
    assert.equal(store.entry(valueSpec()), entry, 'one entry per key');
    let renders = 0;
    entry.subscribe(() => (renders += 1));
    await tick();
    const ready = entry.snapshot();
    assert.equal(ready.status, 'ready');
    assert.equal(ready.data, 1);
    assert.equal(entry.snapshot(), ready);
    assert.equal(source.calls, 1);
    assert.equal(renders, 1);
  });

  it('refetches on a notice while on screen and keeps the snapshot when the answer is unchanged', async () => {
    const { source, feed, entry } = setup();
    entry.subscribe(() => {});
    await tick();
    const first = entry.snapshot();
    feed.emit();
    await tick();
    assert.equal(source.calls, 2);
    assert.equal(entry.snapshot(), first, 'same data, same object: no re-render');
    source.value = 2;
    feed.emit();
    await tick();
    assert.equal(entry.snapshot().data, 2);
  });

  it('coalesces notices of the same tick and never overlaps fetches of a key', async () => {
    const { source, feed, entry } = setup();
    entry.subscribe(() => {});
    await tick();
    feed.emit();
    feed.emit();
    feed.emit();
    await tick();
    assert.equal(source.calls, 2, 'three notices, one refetch');
    entry.refetch();
    entry.refetch();
    await tick();
    assert.equal(source.calls, 4, 'a refetch requested mid-flight runs once, after the current one');
  });

  it('marks unwatched entries stale and refetches them on the next subscribe', async () => {
    const { source, feed, entry } = setup();
    const stop = entry.subscribe(() => {});
    await tick();
    stop();
    source.value = 3;
    feed.emit();
    await tick();
    assert.equal(source.calls, 1, 'nothing on screen, nothing fetched');
    entry.subscribe(() => {});
    await tick();
    assert.equal(source.calls, 2);
    assert.equal(entry.snapshot().data, 3);
  });

  it('ignores notices the spec says do not concern it', async () => {
    const { source, feed, entry } = setup({ affected: false });
    entry.subscribe(() => {});
    await tick();
    feed.emit();
    await tick();
    assert.equal(source.calls, 1);
  });

  it('turns refusals into errors, keeps the last data on unexpected failures, and retries', async () => {
    const { source, feed, entry } = setup();
    entry.subscribe(() => {});
    await tick();
    source.fail = 'throw';
    feed.emit();
    await tick();
    const failed = entry.snapshot();
    assert.equal(failed.status, 'error');
    assert.equal(failed.error, UNEXPECTED_ERROR);
    assert.equal(failed.data, 1, 'the screen stays readable');
    source.fail = 'refuse';
    failed.retry();
    await tick();
    const refused = entry.snapshot();
    assert.deepEqual(refused.error, { code: 'not_found', message: 'Não encontramos esta produção.' });
    assert.equal(refused.data, undefined);
    delete source.fail;
    refused.retry();
    await tick();
    assert.equal(entry.snapshot().status, 'ready');
  });

  it('evicts an entry a while after its last screen leaves', async () => {
    const { source, scheduler, store, entry } = setup();
    const stop = entry.subscribe(() => {});
    await tick();
    stop();
    scheduler.runAll();
    const fresh = store.entry(valueSpec());
    assert.notEqual(fresh, entry);
    fresh.subscribe(() => {});
    await tick();
    assert.equal(source.calls, 2);
  });

  it('stops listening to changes on dispose', async () => {
    const { feed, store, entry, source } = setup();
    entry.subscribe(() => {});
    await tick();
    store.dispose();
    assert.equal(feed.size(), 0);
    feed.emit();
    await tick();
    assert.equal(source.calls, 1);
  });
});
