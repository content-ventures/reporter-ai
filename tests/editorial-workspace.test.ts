import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { editorialTransaction, editorialWorkspace } from '../src/server/editorial.ts';
import { runWithReporterContext } from '../src/server/request-context.ts';
import { localContext } from '../src/server/config.ts';
import { runEditorialJob } from '../src/server/editorial-worker.ts';

const emptyDelta = (seq: number) => ({ seq, workspace: null, productions: [], parts: [], sources: [], runs: [], events: [], items: [] });
const emptyRows = (seq: number) => ({ ...emptyDelta(seq), pipelines: [] });

test('unchanged polls read only the stamp, later changes arrive as deltas, identity or membership changes resend a snapshot', async () => {
  const globals = globalThis as typeof globalThis & { reporterPools?: Partial<Record<'runtime' | 'worker', Pool>> };
  const previous = globals.reporterPools, previousMode = process.env.REPORTER_DEPLOYMENT_MODE;
  let loads = 0, deltas = 0, seq = 42, membersHash = 'members';
  const client = { release() {}, async query(sql: string) {
    if (sql.includes('reporter_ed_status')) return { rows: [{ value: { seq, floor: 0, membersHash } }] };
    if (sql.includes('reporter_ed_load')) { loads++; return { rows: [{ value: emptyRows(seq) }] }; }
    if (sql.includes('reporter_ed_changes')) { deltas++; return { rows: [{ value: emptyDelta(seq) }] }; }
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
    assert.deepEqual([loads, deltas], [1, 0], 'an unchanged poll never reads editorial rows');
    membersHash = 'updated-members';
    const membership = await editorialWorkspace(first.syncToken);
    assert.equal('unchanged' in membership, false);
    assert.equal(loads, 2);
    const identity = await runWithReporterContext({ ...localContext, name: 'Changed name', roles: [...localContext.roles] }, () => editorialWorkspace(membership.syncToken));
    assert.equal('unchanged' in identity, false);
    assert.equal(loads, 3);
    seq++;
    const changed = await editorialWorkspace(membership.syncToken);
    assert.equal(changed.revision, 43);
    assert.equal('delta' in changed, true, 'a known number receives only the rows stamped after it');
    assert.deepEqual([loads, deltas], [3, 1]);
  } finally {
    globals.reporterPools = previous;
    if (previousMode === undefined) delete process.env.REPORTER_DEPLOYMENT_MODE; else process.env.REPORTER_DEPLOYMENT_MODE = previousMode;
  }
});

test('an idle worker claims nothing and never loads or writes editorial rows', async () => {
  const globals = globalThis as typeof globalThis & { reporterPools?: Partial<Record<'runtime' | 'worker', Pool>> };
  const previous = globals.reporterPools, previousMode = process.env.REPORTER_DEPLOYMENT_MODE;
  const queries: string[] = [];
  const client = { release() {}, async query(sql: string) {
    queries.push(sql);
    if (sql.includes('reporter_ed_claim')) return { rows: [{ claim: null }] };
    if (sql.includes('reporter_ed_load') || sql.includes('reporter_ed_commit')) throw new Error('Idle row transfer');
    return { rows: [] };
  } };
  process.env.REPORTER_DEPLOYMENT_MODE = 'local';
  globals.reporterPools = { worker: { connect: async () => client } as unknown as Pool };
  try {
    assert.equal(await runEditorialJob('test-worker', new AbortController().signal), false);
    assert.ok(queries.some(sql => sql.includes('reporter_worker_next')));
    assert.ok(!queries.some(sql => sql.includes('reporter_ed_claim')),'no workspace task is touched when the directory has no eligible client');
  } finally {
    globals.reporterPools = previous;
    if (previousMode === undefined) delete process.env.REPORTER_DEPLOYMENT_MODE; else process.env.REPORTER_DEPLOYMENT_MODE = previousMode;
  }
});

test('only polls that follow a running generation read the queue, and cloud polls never read worker liveness', async () => {
  const globals = globalThis as typeof globalThis & { reporterPools?: Partial<Record<'runtime' | 'worker', Pool>> };
  const previous = globals.reporterPools, previousMode = process.env.REPORTER_DEPLOYMENT_MODE;
  const queries: string[] = [];
  const client = { release() {}, async query(sql: string) {
    queries.push(sql);
    if (sql.includes('reporter_ed_status')) return { rows: [{ value: { seq: 7, floor: 0, membersHash: 'members' } }] };
    if (sql.includes('reporter_queue_status')) return { rows: [{ value: { pending: true, stalled: true } }] };
    if (sql.includes('reporter_ed_load')) return { rows: [{ value: emptyRows(7) }] };
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
    assert.equal(queries.filter(sql => sql.includes('reporter_queue_status')).length, 0, 'an idle poll reads only the change stamp');
    assert.deepEqual([idle.workerOnline, idle.stalled], [true, false]);
    const active = await runWithReporterContext(context, () => editorialWorkspace(first.syncToken, { active: true }));
    assert.equal(queries.filter(sql => sql.includes('reporter_queue_status')).length, 1);
    assert.deepEqual([active.workerOnline, active.stalled], [true, true], 'a stalled run is reported without blocking generation');
  } finally {
    globals.reporterPools = previous;
    if (previousMode === undefined) delete process.env.REPORTER_DEPLOYMENT_MODE; else process.env.REPORTER_DEPLOYMENT_MODE = previousMode;
  }
});

test('a lock cycle or a duplicate receipt reruns the transaction on fresh rows; other errors do not', async () => {
  const globals = globalThis as typeof globalThis & { reporterPools?: Partial<Record<'runtime' | 'worker', Pool>> };
  const previous = globals.reporterPools, previousMode = process.env.REPORTER_DEPLOYMENT_MODE;
  let failures: string[] = [], loads = 0;
  const client = { release() {}, async query(sql: string) {
    if (sql.includes('reporter_ed_load')) { loads++; return { rows: [{ value: emptyRows(5) }] }; }
    if (sql.includes('reporter_ed_commit')) {
      const code = failures.shift();
      if (code) throw Object.assign(new Error('rolled back'), { code });
      return { rows: [{ seq: 6 }] };
    }
    return { rows: [] };
  } };
  process.env.REPORTER_DEPLOYMENT_MODE = 'local';
  globals.reporterPools = { runtime: { connect: async () => client } as unknown as Pool };
  try {
    // A portal without a workspace row always writes one, so every attempt reaches the commit.
    failures = ['40P01', '40001'];
    const rerun = await editorialTransaction('runtime', async () => loads);
    assert.deepEqual([rerun.value, rerun.revision, loads], [3, 6, 3]);
    failures = ['23505'];
    await assert.rejects(editorialTransaction('runtime', async () => loads), { code: '23505' });
    assert.equal(loads, 4, 'a constraint error is not retried');
    failures = ['40001', '40001', '40001'];
    await assert.rejects(editorialTransaction('runtime', async () => loads), { code: '40001' });
    assert.equal(loads, 7, 'reruns are bounded');
  } finally {
    globals.reporterPools = previous;
    if (previousMode === undefined) delete process.env.REPORTER_DEPLOYMENT_MODE; else process.env.REPORTER_DEPLOYMENT_MODE = previousMode;
  }
});

test('edits made in place on loaded rows are written, never mistaken for the unchanged baseline', async () => {
  const globals = globalThis as typeof globalThis & { reporterPools?: Partial<Record<'runtime' | 'worker', Pool>> };
  const previous = globals.reporterPools, previousMode = process.env.REPORTER_DEPLOYMENT_MODE;
  const rows = { ...emptyRows(3),
    runs: [{ id: 'run-1', productionId: 'production-1', status: 'running', availableAt: 0, lease: null, attempts: 1,
      job: { meta: { runId: 'run-1', productionId: 'production-1' }, kind: 'article.draft', input: {}, calls: [] },
      fold: { seq: 1, run: { id: 'run-1', productionId: 'production-1', status: 'running', steps: [] } } }],
    items: [{ kind: 'image_asset', id: 'asset-1', productionId: 'production-1', doc: { productionId: 'production-1', asset: { id: 'asset-1', credit: 'Antes' } } }] };
  let committed: { runs: { job: { calls: unknown[] } }[]; items: { id: string; doc: { asset: { credit: string } } }[] } | undefined;
  const client = { release() {}, async query(sql: string, values: unknown[] = []) {
    if (sql.includes('reporter_ed_load')) return { rows: [{ value: structuredClone(rows) }] };
    if (sql.includes('reporter_ed_commit')) { committed = JSON.parse(String(values[0])); return { rows: [{ seq: 4 }] }; }
    return { rows: [] };
  } };
  process.env.REPORTER_DEPLOYMENT_MODE = 'local';
  globals.reporterPools = { runtime: { connect: async () => client } as unknown as Pool };
  try {
    await editorialTransaction('runtime', async checkpoint => {
      checkpoint.jobs['run-1'].calls!.push({ key: 'outline', hash: 'call-1', model: 'model', status: 'running', startedAt: '2026-10-15T00:00:00Z' });
      checkpoint.imageAssets![0].asset.credit = 'Depois';
    }, true, 'reporter.edit', { runs: ['run-1'], items: { image_asset: ['asset-1'] } });
    assert.equal(committed?.runs[0]?.job.calls.length, 1, 'a call appended to the loaded job is written');
    assert.equal(committed?.items.find(item => item.id === 'asset-1')?.doc.asset.credit, 'Depois', 'an asset patched in place is written');
  } finally {
    globals.reporterPools = previous;
    if (previousMode === undefined) delete process.env.REPORTER_DEPLOYMENT_MODE; else process.env.REPORTER_DEPLOYMENT_MODE = previousMode;
  }
});
