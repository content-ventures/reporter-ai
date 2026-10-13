import assert from 'node:assert/strict';
import test from 'node:test';
import { drainEditorialQueue } from '../functions/reporter-worker.ts';

test('scheduled worker heartbeats once and drains bounded editorial work',async () => {
  let heartbeats = 0,runs = 0,now = 1000;
  const result = await drainEditorialQueue('worker-test',new AbortController().signal,{
    heartbeat: async () => { heartbeats++; },
    run: async () => ++runs < 3,
    now: () => now++,
  });
  assert.deepEqual(result,{ processed: 2,elapsedMs: 4 });
  assert.equal(heartbeats,1);
  assert.equal(runs,3);
});

test('scheduled worker stops before starting work when already aborted',async () => {
  const controller = new AbortController();controller.abort();
  let runs = 0;
  const result = await drainEditorialQueue('worker-test',controller.signal,{
    heartbeat: async () => {},run: async () => { runs++;return true; },now: () => 1000,
  });
  assert.equal(result.processed,0);
  assert.equal(runs,0);
});
