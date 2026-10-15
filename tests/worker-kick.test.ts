import assert from 'node:assert/strict';
import { test } from 'node:test';
import { kickWorker, shouldHealStall } from '../src/server/worker-kick.ts';

function withEnv(values: Record<string, string | undefined>, run: () => Promise<void>) {
  const previous = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]));
  for (const [name, value] of Object.entries(values)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
  return run().finally(() => {
    for (const [name, value] of Object.entries(previous)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
  });
}

test('a kick posts to the configured worker drain with the worker secret and never throws', () => withEnv({
  REPORTER_DEPLOYMENT_MODE: 'cloud', REPORTER_WORKER_URL: 'https://br-main-reporterworker.example.dev/', REPORTER_WORKER_PASSWORD: 'worker-secret',
}, async () => {
  const calls: [string, RequestInit | undefined][] = [];
  await kickWorker(async (input, init) => { calls.push([String(input), init]); return new Response(null, { status: 202 }); });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://br-main-reporterworker.example.dev/drain');
  assert.equal(calls[0][1]?.method, 'POST');
  assert.equal((calls[0][1]?.headers as Record<string, string>)['x-reporter-worker-key'], 'worker-secret');
  await kickWorker(async () => { throw new Error('network down'); });
  await kickWorker(async () => new Response('busy', { status: 503 }));
}));

test('local mode and an unconfigured cloud environment never call out', () => withEnv({
  REPORTER_DEPLOYMENT_MODE: 'local', REPORTER_WORKER_URL: 'https://br-main-reporterworker.example.dev', REPORTER_WORKER_PASSWORD: 'worker-secret',
}, async () => {
  let calls = 0;
  const count = async () => { calls++; return new Response(null, { status: 202 }); };
  await kickWorker(count);
  process.env.REPORTER_DEPLOYMENT_MODE = 'cloud';
  delete process.env.REPORTER_WORKER_URL;
  await kickWorker(count);
  process.env.REPORTER_WORKER_URL = 'http://worker.example.dev';
  await kickWorker(count);
  assert.equal(calls, 0);
}));

test('stalls seen by polls wake the worker at most once a minute per instance', () => {
  const start = 10_000_000_000;
  assert.equal(shouldHealStall(start), true);
  assert.equal(shouldHealStall(start + 30_000), false);
  assert.equal(shouldHealStall(start + 60_000), true);
});
