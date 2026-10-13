import assert from 'node:assert/strict';
import test from 'node:test';
import { createReporterWorker, drainEditorialQueue } from '../functions/reporter-worker.ts';
import { cloudPortalId } from '../src/server/config.ts';

test('cloud portal accepts the deterministic UUID used by the Reporter AI seed',() => {
  const previous = process.env.REPORTER_DEFAULT_PORTAL_ID;
  process.env.REPORTER_DEFAULT_PORTAL_ID = '10000000-0000-0000-0000-000000000101';
  try { assert.equal(cloudPortalId(),'10000000-0000-0000-0000-000000000101'); }
  finally {
    if (previous === undefined) delete process.env.REPORTER_DEFAULT_PORTAL_ID;
    else process.env.REPORTER_DEFAULT_PORTAL_ID = previous;
  }
});

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

test('scheduled delivery is authenticated, heartbeats and returns the drained count',async () => {
  const heartbeats: string[] = [];
  const worker = createReporterWorker({
    heartbeat: async owner => { heartbeats.push(owner); },
    run: async () => false,
    now: () => 1000,
  });
  const invocationId = 'test-invocation';
  const response = await worker.fetch(new Request('https://worker.test/',{
    method: 'POST',headers: { 'content-type': 'application/json','x-neon-trigger-invocation-id': invocationId },
    body: JSON.stringify({ version: 1,invocation_id: invocationId,
      trigger: { type: 'schedule',id: 'trigger-test',name: 'every-minute' },
      data: { scheduled_at: '2026-10-13T18:00:00Z' },
    }),
  }));
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ ok: true,processed: 0 });
  assert.equal(heartbeats.length,1);
  assert.match(heartbeats[0],/^reporter-neon-/);
});

test('health check requires the worker secret and reports database readiness',async () => {
  const previous = process.env.REPORTER_WORKER_PASSWORD;
  process.env.REPORTER_WORKER_PASSWORD = 'worker-secret';
  try {
    let heartbeats = 0;
    const worker = createReporterWorker({ heartbeat: async () => { heartbeats++; },run: async () => false,now: Date.now });
    const denied = await worker.fetch(new Request('https://worker.test/',{ method: 'POST' }));
    const ready = await worker.fetch(new Request('https://worker.test/',{
      method: 'POST',headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ health_secret: 'worker-secret' }),
    }));
    assert.equal(denied.status,401);
    assert.equal(ready.status,200);
    assert.equal(heartbeats,1);
  } finally {
    if (previous === undefined) delete process.env.REPORTER_WORKER_PASSWORD;
    else process.env.REPORTER_WORKER_PASSWORD = previous;
  }
});
