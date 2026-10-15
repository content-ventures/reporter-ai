import assert from 'node:assert/strict';
import { get } from 'node:http';
import { test } from 'node:test';
import { withCloudMediaSource } from '../src/server/cloud-media-source.ts';

function read(url: string, headers = {}) {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
    get(url, { headers }, response => {
      let body = '';
      response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
      response.on('error', reject); response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, body }));
    }).once('error', reject);
  });
}

test('cloud media bridge forwards byte ranges over verified HTTPS and closes its listener after conversion', async context => {
  const upstream: unknown[] = [];
  context.mock.method(globalThis, 'fetch', async (url: URL, options: RequestInit) => {
    upstream.push([url.toString(), options.headers, options.redirect]);
    return new Response('audio', { status: 206, headers: { 'content-length': '5', 'content-range': 'bytes 10-14/1000' } });
  });
  let endpoint = '';
  await withCloudMediaSource('https://storage.test/source?private-signature=opaque', new AbortController().signal, async url => {
    endpoint = url;
    const result = await read(url, { Range: 'bytes=10-14' });
    assert.equal(result.status, 206); assert.equal(result.body, 'audio');
    assert.equal(result.headers['content-range'], 'bytes 10-14/1000');
    assert.deepEqual(upstream, [['https://storage.test/source?private-signature=opaque', { Range: 'bytes=10-14' }, 'error']]);
    assert.equal((await read(url + '/other')).status, 404);
    assert.equal((await read(url, { Range: 'bytes=0-1,2-3' })).status, 416);
    assert.equal(upstream.length, 1);
  });
  await assert.rejects(read(endpoint), error => ['ECONNREFUSED', 'ECONNRESET'].includes((error as NodeJS.ErrnoException).code ?? ''));
});

test('cloud media bridge hides upstream failure details and refuses plaintext source URLs', async context => {
  context.mock.method(globalThis, 'fetch', async () => new Response('secret upstream body', { status: 403 }));
  await withCloudMediaSource('https://storage.test/private', new AbortController().signal, async url => {
    const result = await read(url); assert.equal(result.status, 502); assert.equal(result.body, '');
  });
  await assert.rejects(withCloudMediaSource('http://storage.test/private', new AbortController().signal, async () => {}), /SOURCE_UNAVAILABLE/);
});
