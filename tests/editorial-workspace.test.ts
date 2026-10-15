import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { editorialWorkspace } from '../src/server/editorial.ts';
import { emptyEditorialCheckpoint } from '../src/runtime/editorial-engine.ts';
import { runWithReporterContext } from '../src/server/request-context.ts';
import { localContext } from '../src/server/config.ts';
import { runEditorialJob } from '../src/server/editorial-worker.ts';

test('unchanged polls avoid checkpoint reads, refresh readiness, and invalidate on identity or membership changes', async () => {
  const globals = globalThis as typeof globalThis & { reporterPools?: Partial<Record<'runtime' | 'worker', Pool>> };
  const previous = globals.reporterPools, previousMode = process.env.REPORTER_DEPLOYMENT_MODE;
  const checkpoint = emptyEditorialCheckpoint();
  checkpoint.imageAssets = [];
  let loads = 0, revision = 42, membersHash = 'members';
  const client = { release() {}, async query(sql: string) {
    if (sql.includes('reporter_editorial_status')) return { rows: [{ value: { revision, membersHash } }] };
    if (sql.includes('reporter_editorial_load')) { loads++; return { rows: [{ value: { revision, checkpoint: structuredClone(checkpoint) } }] }; }
    return { rows: [] };
  } };
  process.env.REPORTER_DEPLOYMENT_MODE = 'local';
  globals.reporterPools = { runtime: { connect: async () => client } as unknown as Pool };
  try {
    const first = await editorialWorkspace();
    assert.equal(loads, 1);
    assert.ok(first.syncToken);
    assert.deepEqual(first.imageAssets, [], 'fresh reviewers receive the durable image inventory');
    const same = await editorialWorkspace(first.syncToken);
    assert.equal('unchanged' in same, true);
    assert.equal(typeof same.workerOnline, 'boolean');
    assert.equal(loads, 1, 'an unchanged poll never loads the large JSON document');
    membersHash = 'updated-members';
    const membership = await editorialWorkspace(first.syncToken);
    assert.equal('unchanged' in membership, false);
    assert.equal(loads, 2);
    const identity = await runWithReporterContext({ ...localContext, name: 'Changed name', roles: [...localContext.roles] }, () => editorialWorkspace(membership.syncToken));
    assert.equal('unchanged' in identity, false);
    assert.equal(loads, 3);
    revision++;
    const changed = await editorialWorkspace(membership.syncToken);
    assert.equal(changed.revision, 43);
    assert.equal('unchanged' in changed, false);
    assert.equal(loads, 4);
  } finally {
    globals.reporterPools = previous;
    if (previousMode === undefined) delete process.env.REPORTER_DEPLOYMENT_MODE; else process.env.REPORTER_DEPLOYMENT_MODE = previousMode;
  }
});

test('an idle worker never loads or saves the editorial checkpoint', async () => {
  const globals = globalThis as typeof globalThis & { reporterPools?: Partial<Record<'runtime' | 'worker', Pool>> };
  const previous = globals.reporterPools, previousMode = process.env.REPORTER_DEPLOYMENT_MODE;
  const queries: string[] = [];
  const client = { release() {}, async query(sql: string) {
    queries.push(sql);
    if (sql.includes('reporter_editorial_pending')) return { rows: [{ pending: false }] };
    if (sql.includes('reporter_editorial_load') || sql.includes('reporter_editorial_save')) throw new Error('Idle checkpoint transfer');
    return { rows: [] };
  } };
  process.env.REPORTER_DEPLOYMENT_MODE = 'local';
  globals.reporterPools = { worker: { connect: async () => client } as unknown as Pool };
  try {
    assert.equal(await runEditorialJob('test-worker', new AbortController().signal), false);
    assert.ok(queries.some(sql => sql.includes('reporter_editorial_pending')));
  } finally {
    globals.reporterPools = previous;
    if (previousMode === undefined) delete process.env.REPORTER_DEPLOYMENT_MODE; else process.env.REPORTER_DEPLOYMENT_MODE = previousMode;
  }
});

test('only polls that follow a running generation read the queue, and cloud polls never read worker liveness', async () => {
  const globals = globalThis as typeof globalThis & { reporterPools?: Partial<Record<'runtime' | 'worker', Pool>> };
  const previous = globals.reporterPools, previousMode = process.env.REPORTER_DEPLOYMENT_MODE;
  const checkpoint = emptyEditorialCheckpoint();
  const queries: string[] = [];
  const client = { release() {}, async query(sql: string) {
    queries.push(sql);
    if (sql.includes('reporter_editorial_status')) return { rows: [{ value: { revision: 7, membersHash: 'members' } }] };
    if (sql.includes('reporter_queue_status')) return { rows: [{ value: { pending: true, stalled: true } }] };
    if (sql.includes('reporter_editorial_load')) return { rows: [{ value: { revision: 7, checkpoint: structuredClone(checkpoint) } }] };
    if (sql.includes('reporter_worker_online')) throw new Error('Cloud polls must not read worker liveness');
    if (sql.includes('reporter_workspace_members')) return { rows: [{ members: [] }] };
    return { rows: [] };
  } };
  process.env.REPORTER_DEPLOYMENT_MODE = 'cloud';
  globals.reporterPools = { runtime: { connect: async () => client } as unknown as Pool };
  try {
    const context = { ...localContext, roles: [...localContext.roles] };
    const first = await runWithReporterContext(context, () => editorialWorkspace());
    const idle = await runWithReporterContext(context, () => editorialWorkspace(first.syncToken));
    assert.equal(queries.filter(sql => sql.includes('reporter_queue_status')).length, 0, 'an idle poll reads only the revision stamp');
    assert.deepEqual([idle.workerOnline, idle.stalled], [true, false]);
    const active = await runWithReporterContext(context, () => editorialWorkspace(first.syncToken, { active: true }));
    assert.equal(queries.filter(sql => sql.includes('reporter_queue_status')).length, 1);
    assert.deepEqual([active.workerOnline, active.stalled], [true, true], 'a stalled run is reported without blocking generation');
  } finally {
    globals.reporterPools = previous;
    if (previousMode === undefined) delete process.env.REPORTER_DEPLOYMENT_MODE; else process.env.REPORTER_DEPLOYMENT_MODE = previousMode;
  }
});
