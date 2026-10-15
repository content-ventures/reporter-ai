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
  const result = await drainEditorialQueue('worker-test','https://worker.test',new AbortController().signal,{
    heartbeat: async () => { heartbeats++; },
    run: async () => ++runs < 3,
    startUpload: async () => ({}),completeUpload: async () => ({}),finalizeObject: async () => ({}),
    now: () => now++,
  });
  assert.deepEqual(result,{ processed: 2,elapsedMs: 4 });
  assert.equal(heartbeats,1);
  assert.equal(runs,3);
});

test('scheduled worker stops before starting work when already aborted',async () => {
  const controller = new AbortController();controller.abort();
  let runs = 0;
  const result = await drainEditorialQueue('worker-test','https://worker.test',controller.signal,{
    heartbeat: async () => {},run: async () => { runs++;return true; },
    startUpload: async () => ({}),completeUpload: async () => ({}),finalizeObject: async () => ({}),now: () => 1000,
  });
  assert.equal(result.processed,0);
  assert.equal(runs,0);
});

test('scheduled delivery is authenticated, heartbeats and returns the drained count',async () => {
  const heartbeats: string[] = [];
  const worker = createReporterWorker({
    heartbeat: async owner => { heartbeats.push(owner); },
    run: async () => false,
    startUpload: async () => ({}),completeUpload: async () => ({}),finalizeObject: async () => ({}),
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

test('rejected trigger deliveries expose only bounded operational codes and never start work',async () => {
  const codes: string[] = [];
  let runs = 0;
  const worker = createReporterWorker({
    rejectedTrigger: code => { codes.push(code); },
    heartbeat: async () => {},run: async () => { runs++; return false; },
    startUpload: async () => ({}),completeUpload: async () => ({}),finalizeObject: async () => ({}),now: Date.now,
  });
  const get = await worker.fetch(new Request('https://worker.test/?secret=private-data'));
  const post = await worker.fetch(new Request('https://worker.test/',{
    method: 'POST',headers: { 'content-type': 'application/json' },body: JSON.stringify({ transcript: 'private editorial text' }),
  }));
  const malformed = await worker.fetch(new Request('https://worker.test/',{
    method: 'POST',headers: { 'x-neon-trigger-invocation-id': 'private-header-value' },body: '{}',
  }));
  assert.equal(get.status,405); assert.equal(post.status,401); assert.equal(malformed.status,400);
  assert.deepEqual(codes,['TRIGGER_GET_WITHOUT_HEADER','TRIGGER_POST_MISSING_HEADER','TRIGGER_POST_INVALID_BODY']);
  assert.equal(runs,0);
});

test('health check requires the worker secret and reports database readiness',async () => {
  const previous = process.env.REPORTER_WORKER_PASSWORD;
  process.env.REPORTER_WORKER_PASSWORD = 'worker-secret';
  try {
    let heartbeats = 0;
    const worker = createReporterWorker({ heartbeat: async () => { heartbeats++; },run: async () => false,
      startUpload: async () => ({}),completeUpload: async () => ({}),finalizeObject: async () => ({}),now: Date.now });
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

test('release health check refuses readiness if storage or media tools fail and does not publish a healthy heartbeat', async () => {
  const previous = process.env.REPORTER_WORKER_PASSWORD;
  process.env.REPORTER_WORKER_PASSWORD = 'worker-secret';
  try {
    let heartbeats = 0;
    const worker = createReporterWorker({ ready: async () => { throw new Error('private infrastructure detail'); },
      heartbeat: async () => { heartbeats++; }, run: async () => false,
      startUpload: async () => ({}), completeUpload: async () => ({}), finalizeObject: async () => ({}), now: Date.now });
    const response = await worker.fetch(new Request('https://worker.test/', { headers: { 'x-reporter-worker-key': 'worker-secret' } }));
    assert.equal(response.status, 503); assert.equal(heartbeats, 0);
    assert.deepEqual(await response.json(), { ok: false, error: 'INTERNAL_ERROR' });
  } finally {
    if (previous === undefined) delete process.env.REPORTER_WORKER_PASSWORD; else process.env.REPORTER_WORKER_PASSWORD = previous;
  }
});

test('browser upload session requires the configured app origin and delegates only the opaque token',async () => {
  const previous = process.env.REPORTER_APP_ORIGIN;
  process.env.REPORTER_APP_ORIGIN = 'https://reporter.test';
  try {
    const seen: unknown[][] = [],sourceId = '550e8400-e29b-41d4-a716-446655440000';
    const worker = createReporterWorker({ heartbeat: async () => {},run: async () => false,
      startUpload: async (...args) => { seen.push(args);return { partSize: 16,parts: [] }; },
      completeUpload: async () => ({}),finalizeObject: async () => ({}),now: Date.now });
    const denied = await worker.fetch(new Request('https://worker.test/uploads/start',{ method: 'POST',
      headers: { origin: 'https://evil.test','content-type': 'application/json' },body: '{}' }));
    const accepted = await worker.fetch(new Request('https://worker.test/uploads/start',{ method: 'POST',
      headers: { origin: 'https://reporter.test','content-type': 'application/json' },
      body: JSON.stringify({ sourceId,token: 'x'.repeat(32) }) }));
    assert.equal(denied.status,403);
    assert.equal(accepted.status,200);
    assert.deepEqual(seen,[[sourceId,'x'.repeat(32)]]);
    assert.equal(accepted.headers.get('access-control-allow-origin'),'https://reporter.test');
  } finally {
    if (previous===undefined) delete process.env.REPORTER_APP_ORIGIN;
    else process.env.REPORTER_APP_ORIGIN = previous;
  }
});

test('storage trigger finalizes the private object before transcription can be claimed',async () => {
  const finalized: string[][] = [];
  const worker = createReporterWorker({ heartbeat: async () => {},run: async () => false,
    startUpload: async () => ({}),completeUpload: async () => ({}),
    finalizeObject: async (bucket,key) => { finalized.push([bucket,key]);return {}; },now: Date.now });
  const invocationId = 'storage-invocation';
  const response = await worker.fetch(new Request('https://worker.test/',{ method: 'POST',
    headers: { 'content-type': 'application/json','x-neon-trigger-invocation-id': invocationId },
    body: JSON.stringify({ version: 1,invocation_id: invocationId,
      trigger: { type: 'storage_object_created',id: 'storage-trigger',name: 'source-created' },
      data: { bucket_name: 'reporter-source-media',object_key: 'incoming/portal/source.mp3' },
    }) }));
  assert.equal(response.status,200);
  assert.deepEqual(finalized,[['reporter-source-media','incoming/portal/source.mp3']]);
});
