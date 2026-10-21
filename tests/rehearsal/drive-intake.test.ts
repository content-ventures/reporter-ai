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
 * The Drive folder intake, rehearsed on the cloud path: the folder script's sync copies the
 * file from a stand-in Drive into storage part by part, the worker transcribes it, and the next
 * syncs create the production once, awaiting authorization. No session is involved.
 */
const APP = 'http://127.0.0.1:3998';
const PORTAL = '10000000-0000-0000-0000-000000000101';
const OWNER = { subject: 'rehearsal-drive-owner', email: 'drive@rehearsal.test', name: 'Dona da pasta', image: undefined, emailVerified: true };
const COLLEAGUE = { subject: 'rehearsal-colleague', email: 'colega@rehearsal.test', name: 'Colega da redação', image: undefined, emailVerified: true };
const SECRET = 'drive-rehearsal-secret-with-more-than-32-chars';
const DRIVE_TOKEN = 'ya29.rehearsal-drive-access-token';
const FILE_ID = '1RehearsalDriveFile_abc-123';
const OPUS_ID = '1RehearsalWhatsAppAudio_xyz-789';
const BROKEN_ID = '1RehearsalCorruptFile_zzz-321';
const RESUMED_ID = '1RehearsalResumedCopy_rst-654';
const BIG_ID = '1RehearsalFiveGigabyteVideo_big-555';
const HUGE_ID = '1RehearsalTwentyOneGigabyteVideo_hug-777';

let db: Awaited<ReturnType<typeof startRehearsalDatabase>>, s3: Awaited<ReturnType<typeof startFakeS3>>;
let host: Awaited<ReturnType<typeof startWorkerHost>>, providers: ReturnType<typeof installFakeProviders>, workDir: string;
let handleReporter: typeof import('../../src/server/http.ts').handleReporter;
let media: Buffer, opus: Buffer, restoreDrive: () => void;
const corrupt = Buffer.alloc(4096, 7);
const drive = { ranges: [] as string[], refused: 0, resumed: [] as string[], failing: 0 };
/** Sizes Drive reports for files too large to stand in memory: their bytes are never served. */
const REPORTED: Record<string, number> = { [BIG_ID]: 5 * 1024 ** 3, [HUGE_ID]: 21 * 1024 ** 3 };
const deferred: Promise<void>[] = [];

async function call<T = Record<string, unknown>>(path: string, body?: unknown, headers: Record<string, string> = {}, who: typeof OWNER = OWNER) {
  const request = new Request(`${APP}/api/reporter/${path}`, body === undefined ? undefined : { method: 'POST',
    headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const response = await handleReporter(request, path.split('/'), { defer: task => { deferred.push(task()); }, identify: async () => who });
  return { status: response.status, body: await response.json() as T };
}

const syncBody = (extra: Record<string, unknown> = {}) => ({ fileId: FILE_ID, name: 'Painel sustentabilidade.wav', size: media.length,
  folder: 'Painel', recordedOn: '2026-10-20', accessToken: DRIVE_TOKEN, ...extra });
type Sync = { stage: string; transcriptId?: string; productionId?: string; url?: string; error?: string; retryAfter?: number };
const sync = (extra?: Record<string, unknown>, secret = SECRET) => call<Sync>('drive/sync', syncBody(extra), { authorization: `Bearer ${secret}` });

async function owner<T extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: db.owner });
  await client.connect();
  try { return (await client.query(sql, values)).rows as T[]; } finally { await client.end(); }
}

async function settle() {
  while (deferred.length) await Promise.all(deferred.splice(0));
  await host.idle();
}

/** Drive's metadata and media endpoints: a file's size and its byte ranges, only with the folder script's token. */
function installFakeDrive() {
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('https://www.googleapis.com/drive/v3/files/')) return inner(input, init);
    const headers = new Headers(init?.headers);
    const path = new URL(url);
    if (headers.get('authorization') !== `Bearer ${DRIVE_TOKEN}`) { drive.refused++; return new Response('{}', { status: 401 }); }
    const id = path.pathname.replace('/drive/v3/files/', '');
    if (path.searchParams.get('fields') === 'size' && REPORTED[id]) return Response.json({ size: String(REPORTED[id]) });
    if (REPORTED[id]) return new Response('{}', { status: 503 });
    const file = ({ [FILE_ID]: media, [OPUS_ID]: opus, [BROKEN_ID]: corrupt, [RESUMED_ID]: media } as Record<string, Buffer>)[id];
    if (file && path.searchParams.get('fields') === 'size') return Response.json({ size: String(file.length) });
    if (!file || path.searchParams.get('alt') !== 'media') return new Response('{}', { status: 404 });
    const range = /^bytes=(\d+)-(\d+)$/.exec(headers.get('range') ?? '');
    if (!range) return new Response(new Uint8Array(file));
    if (id === RESUMED_ID) {
      drive.resumed.push(range[0]);
      // Drive fails the second part for a while: the copy stops with only the first one stored.
      if (Number(range[1]) > 0 && drive.failing > 0) { drive.failing--; return new Response('{}', { status: 503 }); }
    } else if (file === media) drive.ranges.push(range[0]);
    const start = Number(range[1]), end = Math.min(Number(range[2]), file.length - 1);
    return new Response(new Uint8Array(file.subarray(start, end + 1)), { status: 206,
      headers: { 'content-range': `bytes ${start}-${end}/${file.length}` } });
  };
  return () => { globalThis.fetch = inner; };
}

before(async () => {
  db = await startRehearsalDatabase([{ email: OWNER.email, role: 'editor' }, { email: COLLEAGUE.email, role: 'editor' }]);
  s3 = await startFakeS3({ bucket: 'reporter-source-media', corsOrigins: [APP] });
  providers = installFakeProviders();
  restoreDrive = installFakeDrive();
  workDir = await mkdtemp(join(tmpdir(), 'reporter-drive-'));
  const file = join(workDir, 'painel.wav');
  // Longer than one 16 MB part, so the copy is split and reassembled.
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=1300',
    '-ac', '1', '-ar', '8000', '-c:a', 'pcm_s16le', file]);
  media = await readFile(file);
  // A WhatsApp voice note: Opus in an Ogg file, named `.opus`.
  const voice = join(workDir, 'zap.opus');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-ac', '1', '-c:a', 'libopus', '-b:a', '24k', voice]);
  opus = await readFile(voice);
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

test('a file dropped in the folder is copied and transcribed, then waits on the board until Nova produção uses it', { timeout: 300_000 }, async () => {
  const first = await sync();
  assert.equal(first.status, 202, JSON.stringify(first.body));
  assert.equal(first.body.stage, 'uploading');
  await settle();
  assert.equal(drive.refused, 0);
  assert.deepEqual(drive.ranges.sort(), ['bytes=0-16777215', `bytes=16777216-${media.length - 1}`].sort(), 'each part is read once, by range');

  const ready = await sync();
  assert.equal(ready.body.stage, 'ready', JSON.stringify(ready.body));
  assert.equal(ready.body.transcriptId, first.body.transcriptId);
  assert.equal(ready.body.url, `${APP}/productions/new?material=${first.body.transcriptId}`, 'the Drive file links to the new-production steps');

  type Received = { id: string; fileName: string; status: string; format?: string; recordedOn?: string; size: number };
  const listed = await call<{ items: Received[] }>('drive/received');
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.deepEqual(listed.body.items.map(item => [item.id, item.fileName, item.status, item.format, item.recordedOn, Number(item.size)]),
    [[first.body.transcriptId, 'Painel sustentabilidade.wav', 'ready', 'panel', '2026-10-20', media.length]], 'the Painel subfolder named the format');
  const one = await call<Received>(`drive/received/${first.body.transcriptId}`);
  assert.equal(one.body.id, first.body.transcriptId);

  type Workspace = { state: { productions: unknown[] } };
  const before = await call<Workspace>('workspace');
  assert.equal(before.body.state.productions.length, 0, 'the intake creates no production by itself');

  const transcript = await call<{ transcript: { segments: { start_ms: number; end_ms: number; text: string }[] } }>(`transcripts/${first.body.transcriptId}`);
  const text = transcript.body.transcript.segments.map((segment, index) => `${index + 1}\n00:00:0${index},000 --> 00:00:0${index + 1},000\n${segment.text}`).join('\n\n');
  const created = await call<{ ok: boolean }>('workspace', { method: 'createFromSource', requestId: randomUUID(), args: [{ title: 'Painel de sustentabilidade',
    plan: ['article'], brief: { sections: 3, size: 'standard', format: 'panel' },
    material: { text, transcriptId: first.body.transcriptId, origin: 'event', authorized: true, recordedOn: '2026-10-20' } }] }, { origin: APP });
  assert.equal(created.body.ok, true, JSON.stringify(created.body));
  const after = await call<{ items: Received[] }>('drive/received');
  assert.deepEqual(after.body.items, [], 'a file that became a production leaves the board');

  const again = await sync();
  assert.equal(again.body.stage, 'ready', 'a later sync changes nothing');
  await settle();
  assert.equal(drive.ranges.length, 2, 'nothing was downloaded twice');
});

test('a WhatsApp audio (.opus) is stored as the Ogg file it is and transcribed, from Drive and from the browser', { timeout: 120_000 }, async () => {
  const name = 'WhatsApp Audio 2026-10-20 at 09.37.11.opus';
  const first = await sync({ fileId: OPUS_ID, name, size: opus.length, folder: undefined });
  assert.equal(first.status, 202, JSON.stringify(first.body));
  assert.equal(first.body.stage, 'uploading');
  await settle();
  const ready = await sync({ fileId: OPUS_ID, name, size: opus.length, folder: undefined });
  assert.equal(ready.body.stage, 'ready', JSON.stringify(ready.body));
  const [stored] = await owner<{ key: string; content_type: string; file_name: string; status: string }>(
    'SELECT key,content_type,file_name,status FROM core.storage_objects WHERE file_name=$1', [name]);
  assert.match(stored.key, /\.ogg$/);
  assert.deepEqual([stored.content_type, stored.file_name, stored.status], ['audio/ogg', name, 'completed']);

  const browser = await call<{ object_key: string }>('uploads', { sourceId: randomUUID(), token: randomUUID() + randomUUID(), name: 'zap.opus', size: opus.length },
    { origin: APP, 'x-reporter-client': 'local', 'idempotency-key': 'rehearsal-opus-upload-01' });
  assert.equal(browser.status, 202, JSON.stringify(browser.body));
  assert.match(browser.body.object_key, /\.ogg$/, 'the browser upload stores the same way');
});

test('a copy that never reaches storage turns failed after an hour and leaves the board after two days', { timeout: 60_000 }, async () => {
  const name = 'Painel sem acesso.mp3';
  const lost = { fileId: '1RehearsalRevokedFile_qwe-456', name, size: 1234, folder: undefined, accessToken: 'ya29.revoked-access-token-0000' };
  const refused = drive.refused;
  const first = await sync(lost);
  assert.equal(first.body.stage, 'uploading', JSON.stringify(first.body));
  await settle();
  assert.ok(drive.refused > refused, 'Drive refused the revoked token, so nothing was copied');
  type Received = { id: string; status: string; errorCode?: string };
  const listed = async () => (await call<{ items: Received[] }>('drive/received')).body.items.filter(item => item.id === first.body.transcriptId);
  assert.deepEqual((await listed()).map(item => item.status), ['transcribing'], 'still within the hour the script keeps retrying');
  await owner("UPDATE public.reporter_drive_intakes SET created_at=clock_timestamp()-interval '2 hours' WHERE transcript_id=$1", [first.body.transcriptId]);
  assert.deepEqual((await listed()).map(item => [item.status, item.errorCode]), [['failed', 'UPLOAD_FAILED']]);
  const abandoned = await sync(lost);
  assert.deepEqual([abandoned.body.stage, abandoned.body.error], ['failed', 'UPLOAD_FAILED'], 'the script files it in Erro');
  assert.equal(deferred.length, 0, 'and no copy starts again');
  await owner("UPDATE public.reporter_drive_intakes SET created_at=clock_timestamp()-interval '3 days' WHERE transcript_id=$1", [first.body.transcriptId]);
  assert.deepEqual(await listed(), [], 'a failed file leaves the board after two days');
});

test('any editor who opens a failed Drive transcription retries it, though the file belongs to the intake owner', { timeout: 120_000 }, async () => {
  const broken = { fileId: BROKEN_ID, name: 'Gravação corrompida.mp3', size: corrupt.length, folder: undefined };
  assert.equal((await sync(broken)).body.stage, 'uploading');
  await settle();
  const failed = await sync(broken);
  assert.equal(failed.body.stage, 'failed', JSON.stringify(failed.body));
  const id = failed.body.transcriptId!;
  const listed = async () => (await call<{ items: { id: string; status: string }[] }>('drive/received', undefined, {}, COLLEAGUE)).body.items.find(item => item.id === id);
  assert.equal((await listed())?.status, 'failed');
  const [before] = await owner<{ revision: number }>('SELECT revision FROM public.reporter_transcripts WHERE id=$1', [id]);
  const headers = { origin: APP, 'x-reporter-client': 'local' };
  const direct = await call(`transcripts/${id}/retry`, { revision: before.revision }, { ...headers, 'idempotency-key': `plain-${id}` }, COLLEAGUE);
  assert.equal(direct.status, 422, 'the plain retry belongs to the uploader, and the colleague did not upload it');
  const retried = await call(`drive/received/${id}/retry`, { revision: before.revision }, { ...headers, 'idempotency-key': `drive-${id}-retry-${before.revision}` }, COLLEAGUE);
  assert.equal(retried.status, 202, JSON.stringify(retried.body));
  await settle();
  const [after] = await owner<{ revision: number; status: string }>('SELECT revision,status FROM public.reporter_transcripts WHERE id=$1', [id]);
  assert.ok(after.revision > before.revision + 1, 'the worker took the file again');
  assert.equal(after.status, 'failed', 'a corrupt file fails again, now with a fresh attempt');
});

test('a file over 2 GB is taken up to 20 GB, by the size Drive reports rather than the script\'s', { timeout: 60_000 }, async () => {
  const huge = await sync({ fileId: HUGE_ID, name: 'Gravação 4K.mp4', size: 3, folder: undefined });
  assert.deepEqual([huge.status, (huge.body as { error?: string }).error], [413, 'FILE_TOO_LARGE'], 'Drive says 21 GB: the script files it in Erro at once');
  assert.equal(deferred.length, 0);

  const big = await sync({ fileId: BIG_ID, name: 'Painel completo.mp4', size: -1, folder: undefined });
  assert.equal(big.status, 202, JSON.stringify(big.body));
  assert.equal(big.body.stage, 'uploading');
  await settle();
  const [stored] = await owner<{ size: string; status: string }>(
    'SELECT s.size::text AS size,s.status FROM core.storage_objects s JOIN public.reporter_transcripts t ON t.source_object_id=s.id WHERE t.id=$1', [big.body.transcriptId]);
  assert.deepEqual(stored, { size: String(5 * 1024 ** 3), status: 'pending' }, 'registered at its 5 GB; this stand-in Drive never serves the bytes');

  // The worker reads such a source too: only the local upload, which is not Drive, keeps 2 GB.
  const capped = await owner<{ proname: string }>("SELECT proname FROM pg_proc WHERE prosrc ~ '2147483648([^0-9]|$)' ORDER BY proname");
  assert.deepEqual(capped.map(row => row.proname), ['reporter_register_upload']);
});

test('a copy cut short continues from the parts already stored, which the folder script reads as progress', { timeout: 300_000 }, async () => {
  const resumed = { fileId: RESUMED_ID, name: 'Palestra completa.wav', size: 3, folder: undefined };
  drive.failing = 3;
  const first = await sync(resumed);
  assert.equal(first.body.stage, 'uploading', JSON.stringify(first.body));
  await settle();
  assert.deepEqual(drive.resumed.filter(range => range === 'bytes=0-16777215'), ['bytes=0-16777215'], 'the first part was stored');
  const id = first.body.transcriptId!;
  const intake = async () => (await owner<{ copied: string; held: boolean }>(
    'SELECT copied_bytes::text AS copied,copy_until IS NOT NULL AS held FROM public.reporter_drive_intakes WHERE transcript_id=$1', [id]))[0];
  assert.deepEqual(await intake(), { copied: String(16 * 1024 ** 2), held: false }, 'the stopped copy recorded its progress and let the file go');

  // Two hours after it arrived, the copy's progress keeps it alive.
  await owner("UPDATE public.reporter_drive_intakes SET created_at=clock_timestamp()-interval '2 hours' WHERE transcript_id=$1", [id]);
  const board = async () => (await call<{ items: { id: string; status: string; size: number }[] }>('drive/received')).body.items.find(item => item.id === id);
  assert.equal((await board())?.status, 'transcribing');

  await owner("UPDATE public.reporter_drive_intakes SET copy_until=clock_timestamp()+interval '5 minutes' WHERE transcript_id=$1", [id]);
  const progress = Math.floor(16 * 1024 ** 2 / media.length * 100);
  const running = await sync(resumed);
  assert.deepEqual([running.body.stage, (running.body as { progress?: number }).progress], ['copying', progress]);
  assert.equal(deferred.length, 0, 'no second copy starts while one holds the file');

  await owner('UPDATE public.reporter_drive_intakes SET copy_until=NULL WHERE transcript_id=$1', [id]);
  const resume = await sync(resumed);
  assert.deepEqual([resume.body.stage, (resume.body as { progress?: number }).progress], ['copying', progress], 'not one of the script\'s upload tries');
  await settle();
  const second = `bytes=16777216-${media.length - 1}`;
  assert.deepEqual(drive.resumed.filter(range => range === 'bytes=0-16777215'), ['bytes=0-16777215'], 'the stored part is not read again');
  assert.equal(drive.resumed.filter(range => range === second).length, 4, 'three refusals, then the part');

  const ready = await sync(resumed);
  assert.equal(ready.body.stage, 'ready', JSON.stringify(ready.body));
  assert.equal(Number((await board())?.size), media.length, 'stored at the size Drive reports, not the script\'s');
});
