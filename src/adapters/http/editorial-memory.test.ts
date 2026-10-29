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
    await library.selectedContext('production/encoded', { sourceId: 'source/encoded', sourceVersion: 2, segmentId: 'segment & literal' });
    assert.equal(seen[7].url.pathname, '/api/reporter/w/editorial-client/memory/productions/production%2Fencoded/sources/source%2Fencoded/context');
    assert.equal(seen[7].url.searchParams.get('sourceVersion'), '2'); assert.equal(seen[7].url.searchParams.get('segmentId'), 'segment & literal');
    assert.equal(seen[7].init.method ?? 'GET', 'GET'); assert.equal(new Headers(seen[7].init.headers).get('x-reporter-account'), 'actual-account');
    const revision = { baseRevision: 2, source: refresh.expected, text: 'A complete corrected synthetic original.', reason: 'Corrected original words.' };
    await library.reviseMaterial('material/encoded', revision, 'stable-material-revision');
    assert.equal(seen[8].url.pathname, '/api/reporter/w/editorial-client/memory/materials/material%2Fencoded/revision');
    assert.equal(new Headers(seen[8].init.headers).get('idempotency-key'), 'stable-material-revision');
    assert.equal(new Headers(seen[8].init.headers).get('x-reporter-account'), 'actual-account'); assert.deepEqual(JSON.parse(String(seen[8].init.body)), revision);
    await library.material('material/encoded', 1);
    assert.equal(seen[9].url.pathname, '/api/reporter/w/editorial-client/memory/materials/material%2Fencoded');
    assert.equal(seen[9].url.searchParams.get('revision'), '1'); assert.equal(seen[9].init.method ?? 'GET', 'GET');
    transport.dispose(); await assert.rejects(library.material('material'));
  } finally { globalThis.fetch = previous; transport.dispose(); }
});

test('a bank command awaits the committed workspace projection and never resubmits after projection failure', async () => {
  const previous = globalThis.fetch, readStarted = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let writes = 0, reads = 0, failProjection = false, settled = false, refuse = 0;
  globalThis.fetch = async () => { writes++; return refuse ? Response.json({ error: refuse === 409 ? 'MEMORY_CONFLICT' : 'FORBIDDEN', message: 'Refused' }, { status: refuse }) : Response.json({ committed: true }); };
  const http = createReporterTransport('editorial-client');
  const library = createHttpMemoryLibrary(http, async () => { reads++; readStarted.resolve(); if (failProjection) throw new Error('Projection unavailable'); await release.promise; });
  const input = { target: { productionId: 'pauta', updatedAt: '2026-10-29T01:00:00Z', draftRevision: 1 },
    expected: { kind: 'source-version' as const, sourceId: 'collection', sourceVersion: 1, hash: '0123456789abcdef' }, selection: null, updateDraftReferences: false, reason: 'Explicit retirement.' };
  try {
    const pending = library.refreshSource('collection', input, 'same-request-key').then(value => { settled = true; return value; });
    await readStarted.promise; assert.equal(settled, false); assert.equal(writes, 1);
    release.resolve(); assert.deepEqual(await pending, { committed: true }); assert.equal(reads, 1);
    failProjection = true; assert.deepEqual(await library.refreshSource('collection', input, 'another-request-key'), { committed: true });
    assert.equal(writes, 2); assert.equal(reads, 2);
    refuse = 403; await assert.rejects(library.refreshSource('collection', input, 'refused-request-key'));
    assert.equal(writes, 3); assert.equal(reads, 2, 'an authorization refusal does not refresh or report a commit');
    refuse = 409; await assert.rejects(library.refreshSource('collection', input, 'conflicting-request-key'), error => (error as { code: string }).code === 'MEMORY_CONFLICT');
    assert.equal(writes, 4); assert.equal(reads, 3, 'a source conflict reconciles newer state without resubmission, even when the read fails');
  } finally { release.resolve(); http.dispose(); globalThis.fetch = previous; }
});
