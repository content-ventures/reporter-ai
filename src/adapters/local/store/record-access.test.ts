import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { paragraphBlock } from '../../../domain/article.ts';
import type { ProductionRecord } from '../../../domain/record.ts';
import { articleBodyFromRun, foldRun, stampRunEvent } from '../../../domain/run-events.ts';
import type { RunEventPayload, RunFold } from '../../../domain/run-events.ts';
import type { GenerationRun } from '../../../domain/run.ts';
import { settleGeneration } from '../../../domain/rules/versions.ts';
import type { CommandContext } from '../../../domain/result.ts';
import type { ChangeNotice } from '../../../ports/common.ts';
import { CONTRACT_TRANSCRIPT, newProductionInput } from '../../../ports/contracts/fixture.ts';
import { SNAPSHOT_KEY } from './snapshot.ts';
import { memoryStorage } from './storage.ts';
import { createTestPorts, testRun } from './testing.ts';
import type { TestPorts } from './testing.ts';

async function production(ports: TestPorts, authorized = true) {
  const created = await ports.commands.createFromSource(newProductionInput({ material: { text: CONTRACT_TRANSCRIPT, origin: 'interview', authorized } }));
  assert.ok(created.ok);
  return { productionId: created.value.productionId, pieceId: created.value.pieces[0].pieceId };
}

function foldFor(run: GenerationRun, payloads: RunEventPayload[]): RunFold {
  const started: RunEventPayload = {
    type: 'run.started',
    kind: run.kind,
    productionId: run.productionId,
    pieceId: run.pieceId ?? '',
    prompt: run.prompt,
    model: run.model,
    inputs: run.inputs,
    steps: run.steps.map((step) => ({ id: step.id, label: step.label })),
    createdBy: run.createdBy,
  };
  const fold = foldRun([started, ...payloads].map((payload, index) => stampRunEvent(payload, run.id, index + 1, run.createdAt)));
  assert.ok(fold);
  return fold;
}

/** What generation's record sync does at a terminal event: pure output becomes v1 · IA. */
function settle(record: ProductionRecord, fold: RunFold, ctx: CommandContext): ProductionRecord {
  const piece = record.pieces.find((entry) => entry.id === fold.run.pieceId);
  assert.ok(piece);
  const settled = settleGeneration(
    { piece, versions: record.versions, output: articleBodyFromRun(fold, { includePartial: fold.run.status !== 'completed' }), runId: fold.run.id, runStartedAt: fold.run.createdAt, interrupted: fold.run.status !== 'completed' },
    ctx,
  );
  return {
    ...record,
    runs: record.runs.map((run) => (run.id === fold.run.id ? fold.run : run)),
    versions: [...record.versions, ...settled.versions],
    pieces: record.pieces.map((entry) => (entry.id === piece.id ? settled.piece : entry)),
  };
}

const EVENTS: RunEventPayload[] = [
  { type: 'step.started', stepId: 'read' },
  { type: 'block.completed', block: paragraphBlock('g-1', 'Doze famílias decidiram vender juntas.', { ai: 'unreviewed' }) },
  { type: 'block.started', block: { id: 'g-2', type: 'paragraph' } },
  { type: 'text.delta', blockId: 'g-2', delta: 'A torrefação mudou a marg' },
];

describe('record access (generation write path)', () => {
  it('derives semantic activity from run and version changes', async () => {
    const ports = createTestPorts();
    const { productionId, pieceId } = await production(ports);
    const notices: ChangeNotice[] = [];
    ports.queries.subscribe((notice) => notices.push(notice));
    let run: GenerationRun | undefined;
    const started = ports.records.apply(productionId, (record, ctx) => {
      run = testRun(ctx.newId('run'), productionId, pieceId, ctx.actorId, ctx.now);
      return { ...record, runs: [...record.runs, run] };
    });
    assert.ok(started.ok && run);
    assert.deepEqual(notices.at(-1)?.activity, ['run.started']);
    const detail = await ports.queries.get(productionId);
    assert.ok(detail.ok && detail.value.activeRuns.length === 1);

    const done = foldFor(run, [...EVENTS, { type: 'text.delta', blockId: 'g-2', delta: 'em.' }, { type: 'run.completed' }]);
    const settled = ports.records.apply(productionId, (record, ctx) => settle(record, done, ctx), { runFold: done });
    assert.ok(settled.ok);
    assert.deepEqual(notices.at(-1)?.activity, ['run.completed', 'version.created']);
    const view = await ports.queries.get(productionId);
    assert.ok(view.ok);
    assert.equal(view.value.pieces[0].latestVersion?.label, 'v1 · IA');
    assert.equal(view.value.activeRuns.length, 0);
  });

  it('keeps stream snapshots quietly and persists them coalesced', async () => {
    const storage = memoryStorage();
    const ports = createTestPorts({ storage });
    const { productionId, pieceId } = await production(ports);
    let run: GenerationRun | undefined;
    ports.records.apply(productionId, (record, ctx) => {
      run = testRun(ctx.newId('run'), productionId, pieceId, ctx.actorId, ctx.now);
      return { ...record, runs: [...record.runs, run] };
    });
    assert.ok(run);
    const notices: ChangeNotice[] = [];
    ports.queries.subscribe((notice) => notices.push(notice));
    const written = storage.getItem(SNAPSHOT_KEY);

    const partial = foldFor(run, EVENTS);
    const quiet = ports.records.apply(productionId, (record) => record, { runFold: partial });
    assert.ok(quiet.ok);
    assert.equal(notices.length, 0, 'a text delta does not wake every screen');
    assert.equal(storage.getItem(SNAPSHOT_KEY), written, 'stream snapshots are coalesced');
    assert.ok(ports.store.flush());
    assert.notEqual(storage.getItem(SNAPSHOT_KEY), written);
    assert.deepEqual(ports.records.runFolds()[run.id]?.blocks.map((block) => block.id), ['g-1', 'g-2']);
  });

  it('recovers runs orphaned by a reload with a pure recovery function', async () => {
    const storage = memoryStorage();
    const first = createTestPorts({ storage });
    const { productionId, pieceId } = await production(first);
    let run: GenerationRun | undefined;
    first.records.apply(productionId, (record, ctx) => {
      run = testRun(ctx.newId('run'), productionId, pieceId, ctx.actorId, ctx.now);
      return { ...record, runs: [...record.runs, run] };
    });
    assert.ok(run);
    first.records.apply(productionId, (record) => record, { runFold: foldFor(run, EVENTS) });
    first.store.flush();

    const reloaded = createTestPorts({ storage, recoverOrphanedRuns: false });
    assert.deepEqual(reloaded.records.productionsWithActiveRuns(), [productionId]);
    const changed = reloaded.records.recover((record, folds, ctx) => {
      const fold = folds[record.runs[0].id];
      assert.ok(fold);
      const cancelled = foldRun([stampRunEvent({ type: 'run.cancelled', reason: 'reload' }, fold.run.id, fold.seq + 1, ctx.now)], fold);
      assert.ok(cancelled);
      return settle(record, cancelled, ctx);
    });
    assert.deepEqual(changed, [productionId]);
    const detail = await reloaded.queries.get(productionId);
    assert.ok(detail.ok);
    assert.equal(detail.value.activeRuns.length, 0);
    assert.equal(detail.value.pieces[0].latestVersion?.label, 'v1 · interrompida');
    const body = (await reloaded.queries.draft(pieceId));
    assert.ok(body.ok && JSON.stringify(body.value.body).includes('A torrefação mudou a'));
    assert.ok(body.ok && !JSON.stringify(body.value.body).includes('marg"'), 'the partial is cut at a word boundary');
  });

  it('hands out copies and refuses unknown productions', async () => {
    const ports = createTestPorts();
    const { productionId } = await production(ports);
    const record = ports.records.record(productionId);
    assert.ok(record);
    record.production.title = 'alterado';
    assert.equal(ports.records.record(productionId)?.production.title, 'Cooperativa Vale Verde');
    assert.equal(ports.records.record('missing'), undefined);
    const missing = ports.records.apply('missing', (entry) => entry);
    assert.equal(missing.ok, false);
  });
});
