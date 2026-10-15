import assert from 'node:assert/strict';
import test from 'node:test';
import { createReporterWorker, type WorkerDependencies } from '../functions/reporter-worker.ts';
import { cloudPortalId } from '../src/server/config.ts';
import type { Pool } from 'pg';
import { COMPACT_INTERVAL_MS, compactEditorialRows, createDrainScheduler, drainQueue, type DrainResult } from '../src/server/worker-drain.ts';

const SOURCE_KEY = 'incoming/10000000-0000-0000-0000-000000000101/550e8400-e29b-41d4-a716-446655440000.mp3';
const IDLE: DrainResult = { processed: 0, remaining: false, elapsedMs: 0 };

/** A worker whose every dependency is observable; deferred work is awaited explicitly. */
function harness(overrides: Partial<WorkerDependencies> = {}) {
  const calls = { drains: 0, pings: 0, chains: [] as number[], finalized: [] as string[][], rejected: [] as string[] };
  const deferred: Promise<unknown>[] = [];
  let now = 1_000_000;
  const services: WorkerDependencies = {
    ready: async () => {},
    ping: async () => { calls.pings++; },
    rejectedTrigger: code => { calls.rejected.push(code); },
    drain: async () => { calls.drains++; return IDLE; },
    chain: async depth => { calls.chains.push(depth); },
    defer: work => { deferred.push(work); },
    startUpload: async () => ({ partSize: 16, parts: [] }),
    completeUpload: async () => ({ accepted: true }),
    finalizeObject: async (bucket, key) => { calls.finalized.push([bucket, key]); return {}; },
    now: () => now,
    ...overrides,
  };
  return { worker: createReporterWorker(services), calls, settle: () => Promise.all(deferred), advance: (ms: number) => { now += ms; } };
}

function withEnv(values: Record<string, string>, run: () => Promise<void>) {
  const previous = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]));
  Object.assign(process.env, values);
  return run().finally(() => {
    for (const [name, value] of Object.entries(previous)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
  });
}

const schedule = (id = 'schedule-invocation') => new Request('https://worker.test/triggers/schedule', { method: 'POST',
  headers: { 'content-type': 'application/json', 'x-neon-trigger-invocation-id': id },
  body: JSON.stringify({ version: 1, invocation_id: id, trigger: { type: 'schedule', id: 'trigger', name: 'sweep' },
    data: { scheduled_at: '2026-10-15T12:00:00Z' } }) });

test('cloud portal accepts the deterministic UUID used by the Reporter AI seed', () => {
  const previous = process.env.REPORTER_DEFAULT_PORTAL_ID;
  process.env.REPORTER_DEFAULT_PORTAL_ID = '10000000-0000-0000-0000-000000000101';
  try { assert.equal(cloudPortalId(), '10000000-0000-0000-0000-000000000101'); }
  finally { if (previous === undefined) delete process.env.REPORTER_DEFAULT_PORTAL_ID; else process.env.REPORTER_DEFAULT_PORTAL_ID = previous; }
});

test('an empty queue costs one pending check and starts no job', async () => {
  let runs = 0;
  const result = await drainQueue('worker-test', new AbortController().signal,
    { pending: async () => false, run: async () => { runs++; return true; }, now: () => 0 });
  assert.deepEqual(result, { processed: 0, remaining: false, elapsedMs: 0 });
  assert.equal(runs, 0);
});

test('a drain stops when the queue empties, and reports leftovers at its job or time budget', async () => {
  let runs = 0, now = 0;
  const queue = { pending: async () => true, run: async () => ++runs < 3, now: () => now++ };
  assert.deepEqual(await drainQueue('worker-test', new AbortController().signal, queue), { processed: 2, remaining: false, elapsedMs: 4 });
  const busy = { pending: async () => true, run: async () => true, now: () => now };
  assert.equal((await drainQueue('worker-test', new AbortController().signal, busy, { maxMs: 60_000, maxJobs: 2 })).remaining, true);
  const yielded = { pending: async () => true, run: async () => 'yield' as const, now: () => now };
  assert.deepEqual(await drainQueue('worker-test', new AbortController().signal, yielded), { processed: 0, remaining: true, elapsedMs: 0 },
    'a yielded job continues in a fresh invocation instead of being claimed again here');
  const aborted = new AbortController(); aborted.abort();
  assert.equal((await drainQueue('worker-test', aborted.signal, busy)).processed, 0);
});

test('housekeeping follows a drain that did work, never an idle one, and never fails it', async () => {
  let compactions = 0, runs = 0;
  const compact = async () => { compactions++; };
  await drainQueue('worker-test', new AbortController().signal, { pending: async () => false, run: async () => true, now: () => 0, compact });
  assert.equal(compactions, 0, 'an idle drain stays a single read');
  await drainQueue('worker-test', new AbortController().signal, { pending: async () => true, run: async () => ++runs < 2, now: () => 0, compact });
  assert.equal(compactions, 1);
  const failing = await drainQueue('worker-test', new AbortController().signal, { pending: async () => true, run: async () => ++runs < 4, now: () => 0,
    compact: async () => { throw new Error('compaction unavailable'); } });
  assert.deepEqual([failing.processed, failing.remaining], [1, false]);
});

test('compaction runs at most once every ten minutes per isolate', async () => {
  const globals = globalThis as typeof globalThis & { reporterPools?: Partial<Record<'runtime' | 'worker', Pool>> };
  const previous = globals.reporterPools, previousMode = process.env.REPORTER_DEPLOYMENT_MODE;
  const statements: string[] = [];
  process.env.REPORTER_DEPLOYMENT_MODE = 'local';
  globals.reporterPools = { worker: { connect: async () => ({ release() {}, async query(sql: string) { statements.push(sql); return { rows: [] }; } }) } as unknown as Pool };
  try {
    const start = 2_000_000_000_000;
    for (const at of [start, start + 60_000, start + COMPACT_INTERVAL_MS]) await compactEditorialRows(at);
    assert.equal(statements.filter(sql => sql.includes('reporter_ed_compact')).length, 2);
  } finally {
    globals.reporterPools = previous;
    if (previousMode === undefined) delete process.env.REPORTER_DEPLOYMENT_MODE; else process.env.REPORTER_DEPLOYMENT_MODE = previousMode;
  }
});

test('one drain runs per isolate; a kick during it buys exactly one more pass', async () => {
  let release!: () => void, passes = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const scheduleDrain = createDrainScheduler({ drain: async () => { passes++; if (passes === 1) await gate; return IDLE; }, chain: async () => {} });
  const first = scheduleDrain(), second = scheduleDrain(), third = scheduleDrain();
  assert.equal(first, second); assert.equal(second, third);
  release(); await first;
  assert.equal(passes, 2);
});

test('work left at the budget continues in a new invocation, up to the chain limit', async () => {
  const chained: number[] = [];
  const busy = createDrainScheduler({ drain: async () => ({ processed: 20, remaining: true, elapsedMs: 1 }),
    chain: async depth => { chained.push(depth); }, maxDepth: 2 });
  await busy(0); await busy(1); await busy(2);
  assert.deepEqual(chained, [1, 2]);
});

test('the drain route requires the worker secret, answers at once and drains in the background', () => withEnv({ REPORTER_WORKER_PASSWORD: 'worker-secret' }, async () => {
  const { worker, calls, settle } = harness();
  assert.equal((await worker.fetch(new Request('https://worker.test/drain', { method: 'POST' }))).status, 401);
  assert.equal(calls.drains, 0);
  const response = await worker.fetch(new Request('https://worker.test/drain', { method: 'POST', headers: { 'x-reporter-worker-key': 'worker-secret' } }));
  assert.equal(response.status, 202);
  await settle();
  assert.equal(calls.drains, 1);
  const waited = await worker.fetch(new Request('https://worker.test/drain?wait=1', { method: 'POST', headers: { 'x-reporter-worker-key': 'worker-secret' } }));
  assert.deepEqual(await waited.json(), { ok: true, ...IDLE });
}));

test('schedule deliveries sweep at most once every few minutes and forged ones never reach the database', async () => {
  const { worker, calls, settle, advance } = harness();
  assert.equal((await worker.fetch(schedule('first'))).status, 202);
  assert.equal((await worker.fetch(schedule('second'))).status, 202);
  await settle();
  assert.equal(calls.drains, 1, 'a burst of deliveries is one sweep');
  advance(5 * 60 * 1000);
  await worker.fetch(schedule('later')); await settle();
  assert.equal(calls.drains, 2);
  const forged = [
    new Request('https://worker.test/triggers/schedule', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"transcript":"private"}' }),
    new Request('https://worker.test/triggers/schedule', { method: 'POST', headers: { 'x-neon-trigger-invocation-id': 'private-header' }, body: '{}' }),
    new Request('https://worker.test/triggers/schedule?secret=private'),
    new Request('https://worker.test/?secret=private'),
  ];
  const statuses = [];
  for (const request of forged) statuses.push((await worker.fetch(request)).status);
  await settle();
  assert.deepEqual(statuses, [401, 400, 405, 404]);
  assert.deepEqual(calls.rejected, ['TRIGGER_MISSING_HEADER', 'TRIGGER_INVALID_BODY', 'TRIGGER_METHOD', 'UNKNOWN_ROUTE']);
  assert.deepEqual([calls.drains, calls.pings], [2, 0], 'forged deliveries start no work and read nothing');
});

test('trigger routes accept hosted Request objects without instanceof or clone dependencies', async () => {
  const { worker, calls, settle } = harness();
  const body = { version: 1, invocation_id: 'native', trigger: { type: 'schedule', id: 'trigger', name: 'sweep' }, data: { scheduled_at: '2026-10-15T12:00:00Z' } };
  const request = { url: 'https://worker.test/triggers/schedule', method: 'POST',
    headers: new Headers({ 'x-neon-trigger-invocation-id': 'native' }),
    clone: () => { throw new Error('Hosted request cannot be cloned'); }, json: async () => body } as unknown as Request;
  assert.equal(request instanceof Request, false);
  assert.equal((await worker.fetch(request)).status, 202);
  await settle();
  assert.equal(calls.drains, 1);
});

test('a storage delivery finalizes only source objects, then starts transcription', async () => {
  const { worker, calls, settle } = harness();
  const delivery = (key: string, type = 'storage_object_created') => new Request('https://worker.test/triggers/storage', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-neon-trigger-invocation-id': 'storage' },
    body: JSON.stringify({ version: 1, invocation_id: 'storage', trigger: { type, id: 'trigger', name: 'source-created' },
      data: type === 'schedule' ? { scheduled_at: '2026-10-15T12:00:00Z' } : { bucket_name: 'reporter-source-media', object_key: key } }) });
  assert.equal((await worker.fetch(delivery('images/portal/hash.png'))).status, 400);
  assert.equal((await worker.fetch(delivery(SOURCE_KEY, 'schedule'))).status, 400);
  assert.equal(calls.finalized.length, 0);
  assert.equal((await worker.fetch(delivery(SOURCE_KEY))).status, 200);
  await settle();
  assert.deepEqual(calls.finalized, [['reporter-source-media', SOURCE_KEY]]);
  assert.equal(calls.drains, 1);
});

test('browser uploads require a configured origin, and completing one starts transcription', () => withEnv({ REPORTER_APP_ORIGINS: 'https://reporter.test,https://staging.reporter.test' }, async () => {
  const seen: unknown[][] = [], sourceId = '550e8400-e29b-41d4-a716-446655440000';
  const { worker, calls, settle } = harness({ startUpload: async (...args) => { seen.push(args); return { partSize: 16, parts: [] }; } });
  const request = (path: string, origin: string) => new Request('https://worker.test' + path, { method: 'POST',
    headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ sourceId, token: 'x'.repeat(32) }) });
  assert.equal((await worker.fetch(request('/uploads/start', 'https://evil.test'))).status, 403);
  const accepted = await worker.fetch(request('/uploads/start', 'https://staging.reporter.test'));
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get('access-control-allow-origin'), 'https://staging.reporter.test');
  assert.deepEqual(seen, [[sourceId, 'x'.repeat(32)]]);
  assert.equal(calls.drains, 0, 'starting an upload queues nothing');
  assert.equal((await worker.fetch(request('/uploads/complete', 'https://reporter.test'))).status, 200);
  await settle();
  assert.equal(calls.drains, 1);
}));

test('the health check requires the secret, proves database reachability and writes nothing', () => withEnv({ REPORTER_WORKER_PASSWORD: 'worker-secret' }, async () => {
  const { worker, calls } = harness();
  assert.equal((await worker.fetch(new Request('https://worker.test/', { method: 'POST' }))).status, 404);
  const ready = await worker.fetch(new Request('https://worker.test/', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ health_secret: 'worker-secret' }) }));
  assert.equal(ready.status, 200);
  assert.deepEqual([calls.pings, calls.drains], [1, 0]);
  const failing = harness({ ready: async () => { throw new Error('private infrastructure detail'); } });
  const response = await failing.worker.fetch(new Request('https://worker.test/', { headers: { 'x-reporter-worker-key': 'worker-secret' } }));
  assert.equal(response.status, 503);
  assert.equal(failing.calls.pings, 0);
  assert.deepEqual(await response.json(), { ok: false, error: 'INTERNAL_ERROR' });
}));
