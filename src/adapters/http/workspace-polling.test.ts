import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestWorkspace, ReporterHttpError, createHttpGeneration } from './reporter-client.ts';
import { compactRunPreviews, foldRun, stampRunEvent } from '../../domain/run-events.ts';
import type { RunEvent, RunEventPayload, RunFold } from '../../domain/run-events.ts';
import type { ConnectedWorkspace } from '../../ports/connected-workspace.ts';
import { ok } from '../../domain/result.ts';

test('workspace polling sends the server stamp and preserves lightweight readiness updates', async () => {
  const original = globalThis.fetch, calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push(String(input));
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.method, 'GET');
    return Response.json({ unchanged: true, revision: 42, syncToken: 'known', workerOnline: false });
  };
  try {
    assert.deepEqual(await requestWorkspace('known'), { unchanged: true, revision: 42, syncToken: 'known', workerOnline: false });
    await requestWorkspace();
    await requestWorkspace('invalid & token');
    await requestWorkspace('known', true);
    await requestWorkspace(undefined, true);
    assert.deepEqual(calls, ['/api/reporter/workspace?since=known', '/api/reporter/workspace', '/api/reporter/workspace?since=invalid%20%26%20token',
      '/api/reporter/workspace?since=known&active=1', '/api/reporter/workspace?active=1']);
  } finally { globalThis.fetch = original; }
});

test('incremental generation listeners keep their cursor after old preview payloads are compacted', () => {
  let events: RunEvent[] = [];
  const append = (payload: RunEventPayload) => { events.push(stampRunEvent(payload, 'run', events.length+1, '2026-10-15T12:00:00Z')); events = compactRunPreviews(events); };
  append({ type: 'run.started', kind: 'article.generate', productionId: 'production', createdBy: 'person', inputs: [], steps: [],
    prompt: { key: 'article', version: '1', hash: 'saved' }, model: { alias: 'model', label: 'Model', engine: 'provider' } });
  const workspace = (): ConnectedWorkspace => ({
    state: { workspace: { id: 'workspace', name: 'Test', slug: 'test', createdAt: '2026-10-15T12:00:00Z' },
      people: [], members: [], sessionPersonId: 'person', sources: [], productions: [], activity: [], feedback: [], history: [], runFolds: { run: foldRun(events)! } },
    jobs: { run: { kind: 'article.draft', input: { productionId: 'production', pieceId: 'piece' }, attempts: 1, availableAt: 0,
      meta: { runId: 'run', productionId: 'production', pieceId: 'piece', label: 'Test', request: { kind: 'article.draft', input: { productionId: 'production', pieceId: 'piece' } } }, events } },
    revision: events.length, model: 'model', workerOnline: true,
  });
  const generation = createHttpGeneration({ current: workspace, refresh: async () => {}, rpc: async () => ok(undefined) as never });
  const received: RunFold[] = [];
  generation.service.watch(update => received.push(update.fold));
  generation.accept(workspace());
  for (let i=0;i<3;i++) {
    append({ type: 'article.preview', body: { type: 'article', title: String(i), blocks: [] } });
    generation.accept(workspace());
    assert.equal(received.at(-1)?.preview?.title, String(i));
  }
  append({ type: 'block.completed', block: { id: 'final', type: 'paragraph', inlines: [{ text: 'Texto final.' }] } });
  append({ type: 'run.completed' });
  generation.accept(workspace());
  assert.equal(received.length, 5);
  assert.deepEqual(received.at(-1), foldRun(events));
  assert.equal(received.at(-1)?.run.status, 'completed');
  generation.dispose();
});

test('an unchanged workspace stamp never conceals authorization failures', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: 'ACCESS_PENDING', message: 'Acesso revogado.' }, { status: 403 });
  try {
    await assert.rejects(requestWorkspace('known'), (error: unknown) => error instanceof ReporterHttpError && error.status === 403 && error.code === 'ACCESS_PENDING');
  } finally { globalThis.fetch = original; }
});
