import assert from 'node:assert/strict';
import test from 'node:test';
import { GetBucketCorsCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';
import { triggerProblems, branchTriggers } from './check-worker-triggers.mjs';
import { drainReceipt } from './check-worker-drain.mjs';
import { configureBucketCors, corsAllows, uploadCorsRules } from './configure-bucket-cors.mjs';
import { migrationProblems, checkMigrations } from './check-migrations.mjs';

const live = (overrides = {}) => [
  { type: 'schedule', trigger_id: 't1', function_slug: 'reporterworker', name: 'reporter-editorial-every-minute',
    function_path: '/triggers/schedule', schedule: { cron: '0 * * * *' }, enabled: true, inherited: false, next_run_at: null, ...overrides.schedule },
  { type: 'storage_object_created', trigger_id: 't2', function_slug: 'reporterworker', name: 'reporter-source-uploaded',
    function_path: '/triggers/storage', storage_object_created: { bucket_name: 'reporter-source-media', prefix: 'incoming/' },
    enabled: true, inherited: false, ...overrides.storage },
];

test('deployed triggers must match neon.ts, fire at most hourly and include nothing undeclared', () => {
  assert.deepEqual(triggerProblems(live()), []);
  assert.deepEqual(triggerProblems(live({ schedule: { schedule: { cron: '* * * * *' } } })), [
    'reporter-editorial-every-minute fires more often than hourly (* * * * *)',
    'reporter-editorial-every-minute differs from neon.ts in cron']);
  const extra = [...live(), { ...live()[0], name: 'leftover-sweep', schedule: { cron: '*/5 * * * *' } }];
  assert.deepEqual(triggerProblems(extra), ['leftover-sweep fires more often than hourly (*/5 * * * *)', 'leftover-sweep is enabled but not declared in neon.ts']);
  assert.deepEqual(triggerProblems([{ ...live()[0], name: 'old-disabled', enabled: false }, ...live()]), [], 'a disabled leftover cannot fire');
  assert.deepEqual(triggerProblems(live({ storage: { enabled: false } })), ['reporter-source-uploaded is declared but not deployed and enabled']);
});

test('the trigger listing reads the branch endpoint and never prints its key', async () => {
  let seen;
  const triggers = await branchTriggers({ projectId: 'p 1', branchId: 'br-1', apiKey: 'key', request: async (url, init) => {
    seen = [url, init.headers.Authorization]; return Response.json({ triggers: live() }); } });
  assert.deepEqual(seen, ['https://console.neon.tech/api/v2/projects/p%201/branches/br-1/triggers', 'Bearer key']);
  assert.equal(triggers.length, 2);
  await assert.rejects(branchTriggers({ projectId: 'p', branchId: 'b', apiKey: 'key', request: async () => new Response('', { status: 403 }) }),
    error => error.message === 'Neon trigger listing failed (HTTP 403).');
});

test('a drain receipt proves the worker reached PostgreSQL; failures name only a code', async () => {
  let call;
  const receipt = await drainReceipt('https://worker.example.test', 'secret', { request: async (url, init) => {
    call = [String(url), init.method, init.headers['x-reporter-worker-key']];
    return Response.json({ ok: true, processed: 2, remaining: false, elapsedMs: 840 }); } });
  assert.deepEqual(call, ['https://worker.example.test/drain?wait=1', 'POST', 'secret']);
  assert.deepEqual(receipt, { processed: 2, remaining: false, elapsedMs: 840 });
  await assert.rejects(drainReceipt('https://worker.example.test', 'secret', { request: async () => Response.json({ ok: false, error: 'DATABASE_UNAVAILABLE' }, { status: 503 }) }),
    /Worker drain failed: DATABASE_UNAVAILABLE/);
  await assert.rejects(drainReceipt('https://worker.example.test', 'secret', { request: async () => Response.json({ ok: false, error: 'postgres://user:pass@host' }, { status: 503 }) }),
    error => error.message === 'Worker drain failed: HTTP_503', 'an unexpected error body is never echoed');
});

test('upload CORS is written once and left alone while it already matches', async () => {
  const origins = ['https://reporter.example.test', 'https://staging.example.test'];
  let stored, puts = 0;
  const client = { async send(command) {
    if (command instanceof GetBucketCorsCommand) {
      if (!stored) throw Object.assign(new Error('none'), { name: 'NoSuchCORSConfiguration' });
      return { CORSRules: stored };
    }
    assert.ok(command instanceof PutBucketCorsCommand);
    puts++; stored = command.input.CORSConfiguration.CORSRules; return {};
  } };
  assert.equal(await configureBucketCors(client, origins), 'updated');
  assert.equal(corsAllows(stored, origins), true, 'the worker readiness accepts what was written');
  assert.equal(await configureBucketCors(client, [...origins].reverse()), 'unchanged');
  assert.equal(await configureBucketCors(client, ['https://reporter.example.test']), 'updated', 'a removed origin is withdrawn');
  assert.deepEqual([puts, stored], [2, uploadCorsRules(['https://reporter.example.test'])]);
  await assert.rejects(configureBucketCors(client, ['https://reporter.example.test/path']), /Not an origin/);
});

test('release migrations must stay additive unless a line is explicitly approved', async () => {
  const sql = ['-- DROP TABLE in a comment is fine', 'CREATE OR REPLACE FUNCTION f() RETURNS void LANGUAGE sql AS $$ DELETE FROM t $$;',
    'DROP TRIGGER IF EXISTS t ON x;', 'ALTER TABLE public.items DROP COLUMN legacy;',
    'DROP TABLE public.old; -- reporter:destructive-approved retired in v0.4 after export'].join('\n');
  assert.deepEqual(migrationProblems('x.sql', sql), { problems: ['x.sql:4 drops a column'], approved: ['x.sql:5 drops a table'] });
  assert.deepEqual((await checkMigrations()).problems, [], 'the current cloud migrations are additive');
});
