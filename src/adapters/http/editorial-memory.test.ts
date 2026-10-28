import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHttpMemoryLibrary } from './editorial-memory.ts';
import { createReporterTransport } from './reporter-client.ts';

test('library commands keep the bound workspace, account and request identity while query cursors remain opaque', async () => {
  const previous = globalThis.fetch, seen: { url: URL; init: RequestInit }[] = [];
  globalThis.fetch = async (input, init = {}) => { seen.push({ url: new URL(String(input), 'http://localhost'), init }); return Response.json({ ok: true }); };
  const transport = createReporterTransport('editorial-client', { requireAccount: true }); transport.bindAccount('actual-account');
  const library = createHttpMemoryLibrary(transport);
  try {
    await library.query({ query: 'estatística & unidade', topics: ['mercado', 'peixes'], cursor: 'opaque+/=cursor', unused: true, useStage: 'approved' });
    assert.equal(seen[0].url.pathname, '/api/reporter/w/editorial-client/memory');
    assert.deepEqual(seen[0].url.searchParams.getAll('topic'), ['mercado', 'peixes']); assert.equal(seen[0].url.searchParams.get('cursor'), 'opaque+/=cursor');
    assert.equal(seen[0].url.searchParams.get('q'), 'estatística & unidade');
    await library.authorizeMaterial('material/encoded', { baseRevision: 1, authorized: true, reason: 'Confirmed source rights.' }, 'stable-request-id');
    assert.equal(seen[1].url.pathname, '/api/reporter/w/editorial-client/memory/materials/material%2Fencoded/authorization');
    assert.equal(new Headers(seen[1].init.headers).get('x-reporter-account'), 'actual-account');
    assert.equal(new Headers(seen[1].init.headers).get('idempotency-key'), 'stable-request-id');
    assert.deepEqual(JSON.parse(String(seen[1].init.body)), { baseRevision: 1, authorized: true, reason: 'Confirmed source rights.' });
    transport.dispose(); await assert.rejects(library.material('material'));
  } finally { globalThis.fetch = previous; transport.dispose(); }
});
