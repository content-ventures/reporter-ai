import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import pg, { type Pool } from 'pg';
import { installFakeProviders } from '../support/fake-providers.ts';
import { startFakeS3 } from '../support/fake-s3.ts';
import { startRehearsalDatabase } from '../support/rehearsal-db.ts';
import { startWorkerHost } from '../support/worker-host.ts';

/**
 * The cloud path, rehearsed locally: the production SQL in PostgreSQL, the Neon worker
 * served over loopback, S3-compatible storage, real FFmpeg and stand-in AI providers. Only
 * the Neon Auth session lookup is replaced; the database still binds that identity.
 */
const APP = 'http://127.0.0.1:3999';
const PORTAL = '10000000-0000-0000-0000-000000000101';
const EDITOR = { subject: 'rehearsal-editor', email: 'editor@rehearsal.test', name: 'Editora do ensaio', image: undefined, emailVerified: true };

type Database = Awaited<ReturnType<typeof startRehearsalDatabase>>;
let db: Database, s3: Awaited<ReturnType<typeof startFakeS3>>, host: Awaited<ReturnType<typeof startWorkerHost>>;
let providers: ReturnType<typeof installFakeProviders>, workDir: string;
let handleReporter: typeof import('../../src/server/http.ts').handleReporter;
const deferred: Promise<void>[] = [];
// REHEARSAL_DEBUG=1 prints each step, which locates a hang the test runner would only report at the end.
const step = (name: string) => { if (process.env.REHEARSAL_DEBUG) console.error(`[rehearsal] ${name}`); };

async function api<T = Record<string, unknown>>(path: string, body?: unknown, headers: Record<string, string> = {}) {
  const request = new Request(`${APP}/api/reporter/${path}`, body === undefined ? undefined : { method: 'POST',
    headers: { origin: APP, 'content-type': 'application/json', 'x-reporter-client': 'local', ...headers }, body: JSON.stringify(body) });
  const response = await handleReporter(request, path.split('?')[0].split('/'), {
    defer: task => { deferred.push(task()); }, identify: async () => EDITOR });
  return { status: response.status, body: await response.json() as T };
}

/** Runs the post-response work (worker wake-ups) and waits for every drain they start. */
async function settle() {
  while (deferred.length) await Promise.all(deferred.splice(0));
  await host.idle();
}

async function owner<T extends pg.QueryResultRow>(sql: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: db.owner });
  await client.connect();
  try { return (await client.query<T>(sql, values)).rows; } finally { await client.end(); }
}

function recordQueries() {
  const pools = (globalThis as typeof globalThis & { reporterPools?: Partial<Record<'runtime' | 'worker', Pool>> }).reporterPools ?? {};
  const seen: { role: string; sql: string }[] = [];
  const restore: (() => void)[] = [];
  const wrapped = new WeakSet<object>();
  for (const [role, pool] of Object.entries(pools)) {
    if (!pool) continue;
    const connect = pool.connect.bind(pool) as (callback?: (error: Error | undefined, client?: pg.PoolClient, done?: () => void) => void) => unknown;
    const watch = (client: pg.PoolClient) => {
      if (wrapped.has(client)) return client;
      wrapped.add(client);
      const query = client.query.bind(client) as (...args: unknown[]) => unknown;
      (client as { query: unknown }).query = (sql: string | { text: string }, ...rest: unknown[]) => {
        if (recording) seen.push({ role, sql: typeof sql === 'string' ? sql : sql.text });
        return query(sql, ...rest);
      };
      return client;
    };
    // pg's Pool.query() calls connect with a callback; awaiting callers use the promise form.
    (pool as { connect: unknown }).connect = (callback?: (error: Error | undefined, client?: pg.PoolClient, done?: () => void) => void) =>
      callback ? connect((error, client, done) => callback(error, client && watch(client), done))
        : (connect() as Promise<pg.PoolClient>).then(watch);
    restore.push(() => { (pool as { connect: unknown }).connect = connect; });
  }
  let recording = true;
  const scaffolding = /^(BEGIN|COMMIT|ROLLBACK|SET LOCAL|SELECT set_config)/;
  return { statements: () => seen.filter(entry => !scaffolding.test(entry.sql.trim())),
    stop: () => { recording = false; restore.forEach(undo => undo()); } };
}

before(async () => {
  step('database');
  db = await startRehearsalDatabase([{ email: EDITOR.email, role: 'editor' }]);
  step('storage');
  s3 = await startFakeS3({ bucket: 'reporter-source-media', corsOrigins: [APP] });
  providers = installFakeProviders({ failTranscriptionCalls: [1] });
  workDir = await mkdtemp(join(tmpdir(), 'reporter-rehearsal-'));
  Object.assign(process.env, {
    REPORTER_DEPLOYMENT_MODE: 'cloud', REPORTER_DATABASE_URL: db.runtime, REPORTER_WORKER_DATABASE_URL: db.worker,
    REPORTER_WORKER_PASSWORD: db.workerPassword, REPORTER_DEFAULT_PORTAL_ID: PORTAL, REPORTER_APP_ORIGINS: APP,
    AWS_ENDPOINT_URL_S3: s3.endpoint, AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'rehearsal', AWS_SECRET_ACCESS_KEY: 'rehearsal',
    GROQ_API_KEY: 'rehearsal-placeholder', GROQ_TRANSCRIPTION_MODEL: 'whisper-large-v3',
  });
  const { createReporterWorker } = await import('../../functions/reporter-worker.ts');
  host = await startWorkerHost(createReporterWorker());
  step('worker host ready');
  process.env.REPORTER_WORKER_URL = host.url;
  ({ handleReporter } = await import('../../src/server/http.ts'));
}, { timeout: 180_000 });

after(async () => {
  providers?.restore();
  await host?.stop();
  await s3?.stop();
  const pools = (globalThis as typeof globalThis & { reporterPools?: Partial<Record<string, Pool>> }).reporterPools ?? {};
  await Promise.all(Object.values(pools).map(pool => pool?.end().catch(() => {})));
  db?.stop();
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

let transcriptId = '', transcriptText = '';

test('a large upload goes straight to storage and is transcribed on demand, resuming after a provider failure', { timeout: 300_000 }, async () => {
  const file = join(workDir, 'ensaio.wav');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=1300',
    '-ac', '1', '-ar', '8000', '-c:a', 'pcm_s16le', file]);
  const bytes = await readFile(file);
  const sourceId = randomUUID(), token = randomUUID() + randomUUID();
  step('prepare upload');
  const prepared = await api<{ id: string; upload_endpoint: string }>('uploads', { sourceId, token, name: 'ensaio.wav', size: bytes.length },
    { 'idempotency-key': 'rehearsal-upload-0001' });
  assert.equal(prepared.status, 202, 'no worker heartbeat is required before uploading');
  assert.equal(prepared.body.upload_endpoint, host.url, 'the browser is pointed at the configured worker');
  transcriptId = prepared.body.id;
  const worker = (path: string) => fetch(host.url + path, { method: 'POST', headers: { origin: APP, 'content-type': 'application/json' },
    body: JSON.stringify({ sourceId, token }) });
  step('start upload');
  const session = await (await worker('/uploads/start')).json() as { partSize: number; parts: { number: number; url: string }[] };
  assert.equal(session.parts.length, Math.ceil(bytes.length / session.partSize));
  for (const part of session.parts) {
    const response = await fetch(part.url, { method: 'PUT', body: bytes.subarray((part.number - 1) * session.partSize, part.number * session.partSize) });
    assert.equal(response.status, 200);
  }
  step('complete upload');
  assert.equal((await worker('/uploads/complete')).status, 200);
  await settle();

  step('first drain settled');
  const [stored] = await owner<{ chunks: number }>('SELECT count(*)::int AS chunks FROM public.reporter_transcript_chunks');
  assert.equal(stored.chunks, 1, 'the chunk transcribed before the provider failure was kept');
  assert.equal(providers.calls.transcriptions, 2);
  await owner("UPDATE core.integration_outbox SET available_at=clock_timestamp() WHERE aggregate_id=$1", [transcriptId]);
  const waiting = await api<{ stalled: boolean }>(`transcripts/${transcriptId}`);
  assert.equal(waiting.body.stalled, false, 'freshly due work is not yet stalled');
  step('retry drain');
  const drained = await fetch(host.url + '/drain', { method: 'POST', headers: { 'x-reporter-worker-key': db.workerPassword } });
  assert.equal(drained.status, 202);
  await settle();

  step('second drain settled');
  const ready = await api<{ transcript: { status: string; content: string } }>(`transcripts/${transcriptId}`);
  assert.equal(ready.body.transcript.status, 'ready');
  assert.equal(providers.calls.transcriptions, 4, 'the retry transcribed only the two chunks that were missing');
  assert.match(ready.body.transcript.content, /Trecho 0 do ensaio\.[\s\S]*Trecho 2 do ensaio\.[\s\S]*Trecho 3 do ensaio\./);
  const [cleared] = await owner<{ chunks: number }>('SELECT count(*)::int AS chunks FROM public.reporter_transcript_chunks');
  assert.equal(cleared.chunks, 0, 'resume chunks are dropped once the transcript is ready');
  transcriptText = ready.body.transcript.content;
});

test('starting a generation wakes the worker, which completes it without any schedule', { timeout: 120_000 }, async () => {
  assert.ok(transcriptText, 'the transcription rehearsal ran first');
  const created = await api<{ ok: boolean; value: { productionId: string } }>('workspace', { method: 'createFromSource', requestId: randomUUID(),
    args: [{ title: 'Ensaio da nuvem', plan: ['article'], brief: { sections: 2, size: 'standard' },
      material: { text: transcriptText, transcriptId, origin: 'podcast', authorized: true, recordedOn: '2026-10-15' } }] });
  assert.equal(created.body.ok, true, JSON.stringify(created.body));
  const workspace = await api<{ state: { productions: { production: { id: string }; pieces: { id: string; kind: string }[] }[] } }>('workspace');
  const production = workspace.body.state.productions.find(entry => entry.production.id === created.body.value.productionId)!;
  const piece = production.pieces.find(entry => entry.kind === 'article')!;
  step('start generation');
  const started = await api<{ ok: boolean; value: { runId: string } }>('workspace', { method: 'generation.start', requestId: randomUUID(),
    args: ['article.outline', { productionId: production.production.id, pieceId: piece.id }] });
  assert.equal(started.body.ok, true, JSON.stringify(started.body));
  assert.equal(deferred.length, 1, 'the committed enqueue scheduled exactly one worker wake-up');
  await settle();
  step('generation settled');
  const done = await api<{ state: { runFolds: Record<string, { run: { status: string } }> } }>('workspace');
  const [job] = await owner<{ job: unknown }>(`SELECT jsonb_build_object('attempts',r.attempts,'availableAt',(extract(epoch FROM r.available_at)*1000)::bigint,
    'calls',r.job->'calls','events',coalesce((SELECT jsonb_agg(e.event ORDER BY e.event_seq) FROM public.reporter_ed_run_events e
      WHERE (e.portal_id,e.run_id)=(r.portal_id,r.run_id)),'[]')) AS job FROM public.reporter_ed_runs r WHERE r.run_id=$1`, [started.body.value.runId]);
  const trace = job.job as { attempts?: number; availableAt?: number; events?: { type: string; error?: unknown; stepId?: string }[]; calls?: unknown[] };
  assert.equal(done.body.state.runFolds[started.body.value.runId].run.status, 'completed', JSON.stringify({ attempts: trace.attempts,
    availableAt: trace.availableAt, calls: trace.calls, events: trace.events?.map(event => [event.type, event.stepId, event.error]) }));
  assert.ok(providers.calls.completions >= 1);
});

test('an idle system reads one flag per sweep and writes nothing; forged deliveries read nothing', { timeout: 60_000 }, async () => {
  step('idle: first poll');
  const polled = await api<{ syncToken: string }>('workspace');
  const queries = recordQueries();
  step('idle: sweep');
  const sweep = await fetch(host.url + '/drain?wait=1', { method: 'POST', headers: { 'x-reporter-worker-key': db.workerPassword }, signal: AbortSignal.timeout(20_000) });
  const result = await sweep.json() as { ok: boolean; processed: number; remaining: boolean };
  assert.deepEqual([result.ok, result.processed, result.remaining], [true, 0, false]);
  const sweepStatements = queries.statements();
  assert.deepEqual(sweepStatements.map(entry => entry.sql.trim()), ['SELECT public.reporter_worker_pending() AS pending'],
    'an empty-queue drain is a single read');
  step('idle: forged delivery');
  const forged = await fetch(host.url + '/triggers/schedule', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(forged.status, 401);
  await host.idle();
  assert.equal(queries.statements().length, 1, 'a forged delivery reads nothing');
  step('idle: unchanged poll');
  const idle = await api<{ unchanged?: boolean; stalled?: boolean }>(`workspace?since=${encodeURIComponent(polled.body.syncToken)}`);
  assert.equal(idle.body.unchanged, true);
  assert.equal(queries.statements().some(entry => /reporter_ed_load|reporter_ed_changes|reporter_queue_status|reporter_worker_online/.test(entry.sql)), false,
    'an idle poll reads only the change stamp and the session');
  queries.stop();
});
