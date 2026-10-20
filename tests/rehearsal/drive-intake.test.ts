import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { Pool } from 'pg';
import { installFakeProviders } from '../support/fake-providers.ts';
import { startFakeS3 } from '../support/fake-s3.ts';
import { startRehearsalDatabase } from '../support/rehearsal-db.ts';
import { startWorkerHost } from '../support/worker-host.ts';

/**
 * The Drive folder intake, rehearsed on the cloud path: the folder script's sync copies the
 * file from a stand-in Drive into storage part by part, the worker transcribes it, and the next
 * syncs create the production once, awaiting authorization. No session is involved.
 */
const APP = 'http://127.0.0.1:3998';
const PORTAL = '10000000-0000-0000-0000-000000000101';
const OWNER = { subject: 'rehearsal-drive-owner', email: 'drive@rehearsal.test', name: 'Dona da pasta', image: undefined, emailVerified: true };
const SECRET = 'drive-rehearsal-secret-with-more-than-32-chars';
const DRIVE_TOKEN = 'ya29.rehearsal-drive-access-token';
const FILE_ID = '1RehearsalDriveFile_abc-123';

let db: Awaited<ReturnType<typeof startRehearsalDatabase>>, s3: Awaited<ReturnType<typeof startFakeS3>>;
let host: Awaited<ReturnType<typeof startWorkerHost>>, providers: ReturnType<typeof installFakeProviders>, workDir: string;
let handleReporter: typeof import('../../src/server/http.ts').handleReporter;
let media: Buffer, restoreDrive: () => void;
const drive = { ranges: [] as string[], refused: 0 };
const deferred: Promise<void>[] = [];

async function call<T = Record<string, unknown>>(path: string, body?: unknown, headers: Record<string, string> = {}) {
  const request = new Request(`${APP}/api/reporter/${path}`, body === undefined ? undefined : { method: 'POST',
    headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const response = await handleReporter(request, path.split('/'), { defer: task => { deferred.push(task()); }, identify: async () => OWNER });
  return { status: response.status, body: await response.json() as T };
}

const syncBody = (extra: Record<string, unknown> = {}) => ({ fileId: FILE_ID, name: 'Painel sustentabilidade.wav', size: media.length,
  folder: 'Painel', recordedOn: '2026-10-20', accessToken: DRIVE_TOKEN, ...extra });
type Sync = { stage: string; transcriptId?: string; productionId?: string; url?: string; error?: string; retryAfter?: number };
const sync = (extra?: Record<string, unknown>, secret = SECRET) => call<Sync>('drive/sync', syncBody(extra), { authorization: `Bearer ${secret}` });

async function settle() {
  while (deferred.length) await Promise.all(deferred.splice(0));
  await host.idle();
}

/** Drive's media endpoint: byte ranges of one file, only with the folder script's token. */
function installFakeDrive() {
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('https://www.googleapis.com/drive/v3/files/')) return inner(input, init);
    const headers = new Headers(init?.headers);
    const path = new URL(url);
    if (headers.get('authorization') !== `Bearer ${DRIVE_TOKEN}`) { drive.refused++; return new Response('{}', { status: 401 }); }
    if (path.pathname !== `/drive/v3/files/${FILE_ID}` || path.searchParams.get('alt') !== 'media') return new Response('{}', { status: 404 });
    const range = /^bytes=(\d+)-(\d+)$/.exec(headers.get('range') ?? '');
    if (!range) return new Response(new Uint8Array(media));
    drive.ranges.push(range[0]);
    const start = Number(range[1]), end = Math.min(Number(range[2]), media.length - 1);
    return new Response(new Uint8Array(media.subarray(start, end + 1)), { status: 206,
      headers: { 'content-range': `bytes ${start}-${end}/${media.length}` } });
  };
  return () => { globalThis.fetch = inner; };
}

before(async () => {
  db = await startRehearsalDatabase([{ email: OWNER.email, role: 'editor' }]);
  s3 = await startFakeS3({ bucket: 'reporter-source-media', corsOrigins: [APP] });
  providers = installFakeProviders();
  restoreDrive = installFakeDrive();
  workDir = await mkdtemp(join(tmpdir(), 'reporter-drive-'));
  const file = join(workDir, 'painel.wav');
  // Longer than one 16 MB part, so the copy is split and reassembled.
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=1300',
    '-ac', '1', '-ar', '8000', '-c:a', 'pcm_s16le', file]);
  media = await readFile(file);
  Object.assign(process.env, {
    REPORTER_DEPLOYMENT_MODE: 'cloud', REPORTER_DATABASE_URL: db.runtime, REPORTER_WORKER_DATABASE_URL: db.worker,
    REPORTER_WORKER_PASSWORD: db.workerPassword, REPORTER_DEFAULT_PORTAL_ID: PORTAL, REPORTER_APP_ORIGINS: APP,
    AWS_ENDPOINT_URL_S3: s3.endpoint, AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'rehearsal', AWS_SECRET_ACCESS_KEY: 'rehearsal',
    GROQ_API_KEY: 'rehearsal-placeholder', GROQ_TRANSCRIPTION_MODEL: 'whisper-large-v3',
    REPORTER_DRIVE_SECRET: SECRET, REPORTER_DRIVE_OWNER_EMAIL: OWNER.email.toUpperCase(),
  });
  const { createReporterWorker } = await import('../../functions/reporter-worker.ts');
  host = await startWorkerHost(createReporterWorker());
  process.env.REPORTER_WORKER_URL = host.url;
  ({ handleReporter } = await import('../../src/server/http.ts'));
}, { timeout: 180_000 });

after(async () => {
  restoreDrive?.();
  providers?.restore();
  await host?.stop();
  await s3?.stop();
  const pools = (globalThis as typeof globalThis & { reporterPools?: Partial<Record<string, Pool>> }).reporterPools ?? {};
  await Promise.all(Object.values(pools).map(pool => pool?.end().catch(() => {})));
  db?.stop();
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

test('the sync refuses a wrong secret and files the transcription cannot read', async () => {
  assert.equal((await sync({}, SECRET.replace(/.$/, 'x'))).status, 401);
  const unsupported = await sync({ name: 'slides.pdf' });
  assert.equal(unsupported.status, 415);
  assert.equal((unsupported.body as { error?: string }).error, 'UNSUPPORTED_MEDIA');
  assert.equal(deferred.length, 0);
});

test('a file dropped in the folder is copied, transcribed and becomes one production awaiting authorization', { timeout: 300_000 }, async () => {
  const first = await sync();
  assert.equal(first.status, 202, JSON.stringify(first.body));
  assert.equal(first.body.stage, 'uploading');
  await settle();
  assert.equal(drive.refused, 0);
  assert.deepEqual(drive.ranges.sort(), ['bytes=0-16777215', `bytes=16777216-${media.length - 1}`].sort(), 'each part is read once, by range');

  const transcribed = await sync();
  assert.equal(transcribed.body.stage, 'creating', JSON.stringify(transcribed.body));
  assert.equal(transcribed.body.transcriptId, first.body.transcriptId);
  await settle();

  const ready = await sync();
  assert.equal(ready.body.stage, 'ready', JSON.stringify(ready.body));
  assert.ok(ready.body.productionId);
  assert.equal(ready.body.url, `${APP}/productions/${ready.body.productionId}`);

  type Workspace = { state: { productions: { production: { id: string; title: string; brief: { format?: string } }; pieces: { kind: string }[] }[];
    sources: { id: string; rights: { authorized: boolean }; origin?: string }[] } };
  const workspace = await call<Workspace>('workspace');
  const created = workspace.body.state.productions.filter(entry => entry.production.id === ready.body.productionId);
  assert.equal(created.length, 1);
  assert.equal(created[0].production.brief.format, 'panel', 'the Painel subfolder chose the format');
  assert.deepEqual(created[0].pieces.map(piece => piece.kind), ['article']);
  assert.ok(workspace.body.state.sources.length >= 1);
  assert.ok(workspace.body.state.sources.every(source => source.rights.authorized === false), 'the speakers have not authorized yet');

  const again = await sync();
  assert.equal(again.body.productionId, ready.body.productionId, 'a later sync finds the same production');
  await settle();
  const after = await call<Workspace>('workspace');
  assert.equal(after.body.state.productions.length, workspace.body.state.productions.length, 'nothing was created twice');
  assert.equal(drive.ranges.length, 2, 'nothing was downloaded twice');
});
