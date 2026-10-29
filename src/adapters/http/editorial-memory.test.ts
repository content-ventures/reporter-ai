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
    assert.equal(new Headers(seen[1].init.headers).get('x-reporter-client'), 'local');
    assert.equal(new Headers(seen[1].init.headers).get('idempotency-key'), 'stable-request-id');
    assert.deepEqual(JSON.parse(String(seen[1].init.body)), { baseRevision: 1, authorized: true, reason: 'Confirmed source rights.' });
    await library.selections({ cursor: 'selection+/=cursor', limit: 25 });
    assert.equal(seen[2].url.pathname, '/api/reporter/w/editorial-client/memory/selections'); assert.equal(seen[2].url.searchParams.get('cursor'), 'selection+/=cursor');
    const writing = { baseRevision: 2, title: 'Actual selection', brief: { size: 'standard' as const, sections: 3 } };
    await library.writeSelection('selection/encoded', writing, 'stable-writing-request');
    assert.equal(seen[3].url.pathname, '/api/reporter/w/editorial-client/memory/selections/selection%2Fencoded/write');
    assert.equal(new Headers(seen[3].init.headers).get('idempotency-key'), 'stable-writing-request');
    assert.equal(new Headers(seen[3].init.headers).get('x-reporter-account'), 'actual-account'); assert.deepEqual(JSON.parse(String(seen[3].init.body)), writing);
    const attachment = { baseRevision: 2, target: { productionId: 'existing-production', updatedAt: '2026-10-28T20:00:00Z' } };
    await library.writeSelection('selection/encoded', attachment, 'stable-attachment-request');
    assert.deepEqual(JSON.parse(String(seen[4].init.body)), attachment);
    assert.equal(new Headers(seen[4].init.headers).get('idempotency-key'), 'stable-attachment-request');
    await library.writingStatus('production/encoded');
    assert.equal(seen[5].url.pathname, '/api/reporter/w/editorial-client/memory/productions/production%2Fencoded/writing-status');
    assert.equal(new Headers(seen[5].init.headers).get('x-reporter-account'), 'actual-account');
    assert.equal(seen[5].init.method ?? 'GET', 'GET');
    const refresh = { target: { ...attachment.target, draftRevision: 3 }, expected: { kind: 'source-version' as const, sourceId: 'source/encoded', sourceVersion: 1, hash: '0123456789abcdef' },
      selection: null, updateDraftReferences: false, reason: 'Explicit retirement.' };
    await library.refreshSource('source/encoded', refresh, 'stable-refresh-request');
    assert.equal(seen[6].url.pathname, '/api/reporter/w/editorial-client/memory/sources/source%2Fencoded/refresh');
    assert.equal(new Headers(seen[6].init.headers).get('x-reporter-account'), 'actual-account');
    assert.equal(new Headers(seen[6].init.headers).get('idempotency-key'), 'stable-refresh-request'); assert.deepEqual(JSON.parse(String(seen[6].init.body)), refresh);
    transport.dispose(); await assert.rejects(library.material('material'));
  } finally { globalThis.fetch = previous; transport.dispose(); }
});
