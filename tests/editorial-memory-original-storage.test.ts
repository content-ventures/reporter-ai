import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, realpath, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readMemoryOriginalObject, workerMemoryOriginalObject, writeMemoryOriginalObject } from '../src/server/editorial-memory-original-storage.ts';
import { runWithReporterContext, type ReporterRequestContext } from '../src/server/request-context.ts';
import { runWithWorkerContext } from '../src/server/worker-context.ts';
import { startFakeS3 } from './support/fake-s3.ts';
import { startWorkerHost } from './support/worker-host.ts';

const first = '10000000-0000-0000-0000-000000000101', second = '20000000-0000-0000-0000-000000000101';
const context = (portal = first): ReporterRequestContext => ({ tenant: '10000000-0000-0000-0000-000000000001', portal,
  actor: '10000000-0000-0000-0000-000000000201', workspaceName: 'Synthetic', workspaceSlug: 'synthetic',
  name: 'Synthetic editor', email: 'original@synthetic.test', roles: ['editor'] });
const content = Buffer.from('\ufeff  Cafe\u0301 😀\r\nInstituição;valor;período\r\nTeste;1.234,56;2025\r\n');
const reference = { checksum: createHash('sha256').update(content).digest('hex'), size: content.length };
const scoped = <T>(portal: string, operation: () => T) => runWithReporterContext(context(portal), operation);

test('local original publication is atomic across retries, private and exact within its workspace', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'reporter-memory-original-'))), previous = process.cwd(), mode = process.env.REPORTER_DEPLOYMENT_MODE;
  process.chdir(directory); process.env.REPORTER_DEPLOYMENT_MODE = 'local';
  try {
    await scoped(first, () => Promise.all(Array.from({ length: 8 }, () => writeMemoryOriginalObject(reference, content))));
    assert.deepEqual(await scoped(first, () => readMemoryOriginalObject(reference)), content);
    const path = join(directory, '.reporter-local', `${first}-${reference.checksum}.memory-original`);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(join(directory, '.reporter-local')), [`${first}-${reference.checksum}.memory-original`]);
    await assert.rejects(scoped(second, () => readMemoryOriginalObject(reference)), { code: 'ENOENT' });
    await assert.rejects(scoped(first, () => writeMemoryOriginalObject({ ...reference, checksum: 'a'.repeat(64) }, content)), /MEMORY_ORIGINAL_CHANGED/);
    const changed = Buffer.from(content); changed[changed.length - 1] ^= 1; await writeFile(path, changed);
    await assert.rejects(scoped(first, () => readMemoryOriginalObject(reference)), /MEMORY_ORIGINAL_CHANGED/);
    await assert.rejects(scoped(first, () => writeMemoryOriginalObject(reference, content)), /MEMORY_ORIGINAL_CHANGED/, 'a retry cannot silently replace a changed existing original');
    await unlink(path);
    const target = join(directory, 'synthetic-link-target'); await writeFile(target, content); await symlink(target, path);
    await assert.rejects(scoped(first, () => readMemoryOriginalObject(reference)), { code: 'ELOOP' });
    await assert.rejects(scoped(first, () => writeMemoryOriginalObject(reference, content)), { code: 'ELOOP' });
  } finally {
    process.chdir(previous); if (mode === undefined) delete process.env.REPORTER_DEPLOYMENT_MODE; else process.env.REPORTER_DEPLOYMENT_MODE = mode;
    await rm(directory, { recursive: true, force: true });
  }
});

test('private original worker gateway preserves real bytes through scoped S3 and rejects malformed or changed input', async () => {
  const storage = await startFakeS3({ bucket: 'reporter-source-media', corsOrigins: [] });
  const settings = { REPORTER_DEPLOYMENT_MODE: 'cloud', REPORTER_WORKER_PASSWORD: `synthetic-${randomUUID()}`, AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'synthetic-access-key', AWS_SECRET_ACCESS_KEY: 'synthetic-secret-key', AWS_ENDPOINT_URL_S3: storage.endpoint };
  const previous = Object.fromEntries([...Object.keys(settings), 'REPORTER_WORKER_URL'].map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  const { createReporterWorker } = await import('../functions/reporter-worker.ts');
  const worker = createReporterWorker(), host = await startWorkerHost(worker); process.env.REPORTER_WORKER_URL = host.url;
  const endpoint = (input: unknown, secret = settings.REPORTER_WORKER_PASSWORD) => fetch(host.url + '/memory-objects', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-reporter-worker-key': secret }, body: JSON.stringify(input) });
  const payload = { ...reference, portal: first, action: 'write', bytes: content.toString('base64') };
  try {
    await scoped(first, () => writeMemoryOriginalObject(reference, content));
    await scoped(first, () => writeMemoryOriginalObject(reference, content));
    assert.deepEqual(await scoped(first, () => readMemoryOriginalObject(reference)), content);
    const key = `reporter-source-media/memory-originals/${first}/${reference.checksum}.original`;
    assert.deepEqual(storage.objects.get(key)?.body, content); assert.equal(storage.objects.get(key)?.contentType, 'application/octet-stream');
    await assert.rejects(scoped(second, () => readMemoryOriginalObject(reference)), /MEMORY_ORIGINAL_UNAVAILABLE/);
    await scoped(second, () => writeMemoryOriginalObject(reference, content));
    assert.deepEqual(await scoped(second, () => readMemoryOriginalObject(reference)), content);
    assert.equal(storage.objects.size, 2);
    const [signed] = storage.requests.filter(request => request.startsWith(`GET /${key}?`)); assert.ok(signed?.includes('X-Amz-Signature'));
    assert.equal((await endpoint(payload, 'wrong-secret')).status, 401);
    assert.equal((await endpoint({ ...payload, key: 'images/other/image' })).status, 422);
    assert.equal((await endpoint({ ...payload, checksum: 'a'.repeat(64) })).status, 422);
    assert.equal((await endpoint({ ...payload, bytes: payload.bytes + ' ' })).status, 422);
    assert.equal((await endpoint({ ...payload, size: 1024 ** 2 + 1 })).status, 422);
    await assert.rejects(runWithWorkerContext({ tenant: context().tenant, portal: second }, () => workerMemoryOriginalObject(payload)), /WORKER_CONTEXT_CHANGED/);
    const huge = await worker.fetch(new Request(host.url + '/memory-objects', { method: 'POST', headers: { 'x-reporter-worker-key': settings.REPORTER_WORKER_PASSWORD }, body: 'x'.repeat(2 * 1024 ** 2 + 1) }));
    assert.equal(huge.status, 413);
    const changed = storage.objects.get(key)!; changed.body[0] ^= 1;
    await assert.rejects(scoped(first, () => readMemoryOriginalObject(reference)), /MEMORY_ORIGINAL_CHANGED/);
    assert.deepEqual(await scoped(second, () => readMemoryOriginalObject(reference)), content);
    assert.equal(storage.objects.size, 2, 'invalid requests never publish another object');
  } finally {
    await host.stop(); await storage.stop();
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
