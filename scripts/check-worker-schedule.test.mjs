import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitForWorkerSchedule } from './check-worker-schedule.mjs';

test('release waits for a fresh scheduled heartbeat rather than accepting the health request', async () => {
  let queries = 0, pauses = 0;
  const since = new Date('2026-10-15T10:00:00Z');
  await waitForWorkerSchedule(async (sql, values) => {
    assert.match(sql, /worker_id LIKE 'reporter-neon-%'/);
    assert.deepEqual(values, ['10000000-0000-0000-0000-000000000101', 'https://worker.test', since.toISOString()]);
    return { rows: [{ ready: ++queries === 2 }] };
  }, 'https://worker.test', { since, sleep: async () => { pauses++; } });
  assert.equal(queries, 2); assert.equal(pauses, 1);
});

test('release stops when a deployed worker has no working schedule', async () => {
  let queries = 0;
  await assert.rejects(waitForWorkerSchedule(async () => {
    queries++; return { rows: [{ ready: false }] };
  }, 'https://worker.test', { attempts: 2, sleep: async () => {} }), /Production release stopped/);
  assert.equal(queries, 2);
});
