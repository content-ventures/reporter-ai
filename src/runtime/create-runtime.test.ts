import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createIdGenerator, manualClock, memoryStorage, SNAPSHOT_KEY } from '../adapters/local/store/index.ts';
import type { ManualClock } from '../adapters/local/store/index.ts';
import type { RunId } from '../domain/ids.ts';
import type { ChangeNotice } from '../ports/common.ts';
import type { ProductionDetail } from '../ports/production-queries.ts';
import { createRuntime } from './create-runtime.ts';
import type { CreateRuntimeOptions } from './create-runtime.ts';
import type { Runtime } from './runtime.ts';

const NOW = '2026-10-07T12:00:00.000Z';
const FLAGSHIP = 'prod-atelie-sul';

/** Simulated delays advance the manual clock and yield a macrotask, so streams interleave. */
function instantSleep(clock: ManualClock) {
  return async (ms: number) => {
    clock.advance(Math.max(0, Math.round(ms)));
    await new Promise<void>((resolve) => setImmediate(resolve));
  };
}

/** The first `free` delays pass instantly; later ones hang until the run is aborted (a frozen tab). */
function freezingSleep(clock: ManualClock, free: number) {
  let count = 0;
  return (ms: number, signal: AbortSignal) => {
    count += 1;
    if (count <= free) return instantSleep(clock)(ms);
    return new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
  };
}

let loads = 0;

function open(options: Partial<CreateRuntimeOptions> & { clock?: ManualClock } = {}): { runtime: Runtime; clock: ManualClock } {
  const clock = options.clock ?? manualClock(NOW);
  const runtime = createRuntime({
    storage: memoryStorage(),
    // A real page load salts its ids at random; each simulated load gets its own salt here.
    ids: createIdGenerator({ salt: `load${(loads += 1)}` }),
    latency: false,
    sleep: instantSleep(clock),
    ...options,
    clock,
  });
  return { runtime, clock };
}

async function finish(runtime: Runtime, runId: RunId) {
  const attached = await runtime.generation.attach(runId);
  assert.ok(attached.ok, 'the run is live in this session');
  for await (const event of attached.value.events) void event;
}

async function detail(runtime: Runtime, productionId: string): Promise<ProductionDetail> {
  const found = await runtime.queries.get(productionId);
  assert.ok(found.ok, `production ${productionId}`);
  return found.value;
}

describe('createRuntime', () => {
  it('opens the fixtures and continues the seeded live run in place until "v1 · IA" settles', async () => {
    const { runtime } = open();
    assert.equal(runtime.mode, 'simulated');
    assert.equal(runtime.simulation?.loadedFrom, 'fixtures');
    const [runId] = runtime.simulation?.adoptedRunIds ?? [];
    assert.ok(runId, 'the flagship opens with a generation running');
    assert.equal((await detail(runtime, FLAGSHIP)).activeRuns.length, 1);

    await finish(runtime, runId);
    await runtime.ready;

    const after = await detail(runtime, FLAGSHIP);
    assert.equal(after.activeRuns.length, 0);
    const article = after.pieces.find((piece) => piece.kind === 'article');
    assert.equal(article?.latestVersion?.label, 'v1 · IA');
    assert.equal(article?.latestVersion?.runId, runId);
    const activity = await runtime.queries.activity({ productionId: FLAGSHIP });
    const types = activity.items.map((item) => item.type);
    assert.ok(types.includes('run.completed'), 'the run ends with an activity event');
    assert.ok(types.includes('version.created'));
    runtime.dispose();
  });

  it('shows one generation per production while it writes a section (section runs stay internal)', async () => {
    const clock = manualClock(NOW);
    const { runtime } = open({ clock, sleep: freezingSleep(clock, 40) });
    const runId = runtime.simulation?.adoptedRunIds[0] ?? '';
    const writingSection = async () => {
      const attached = await runtime.generation.attach(runId);
      return attached.ok && attached.value.snapshot.run.steps.some((step) => step.id.startsWith('section-') && step.state === 'current');
    };
    for (let tries = 0; tries < 500 && !(await writingSection()); tries += 1) await new Promise<void>((resolve) => setImmediate(resolve));
    runtime.flush();
    const during = await detail(runtime, FLAGSHIP);
    assert.ok(during.runs.some((run) => run.parentRunId === runId && run.status === 'running'), 'a section run is streaming');
    assert.deepEqual(during.activeRuns.map((run) => run.id), [runId]);
    assert.equal(during.pieces.find((piece) => piece.kind === 'article')?.activeRun?.id, runId);
    assert.equal((await runtime.queries.overview('7d')).metrics.generatingNow, 1);
    runtime.dispose();
  });

  it('keeps runs started through the commands alive in the runtime until they settle', async () => {
    const { runtime } = open();
    await finish(runtime, runtime.simulation?.adoptedRunIds[0] ?? '');
    const production = await detail(runtime, 'prod-couro-nobre');
    const article = production.pieces.find((piece) => piece.kind === 'article');
    assert.ok(article);

    const blocked = await runtime.generation.start('article.draft', { productionId: production.id, pieceId: article.id });
    assert.equal(!blocked.ok && blocked.refusal.code, 'source_not_authorized', 'unauthorised material blocks generation');

    const authorised = await runtime.commands.setMaterialAuthorization(production.sources[0].id, true);
    assert.ok(authorised.ok);
    const notices: ChangeNotice[] = [];
    runtime.subscribe((notice) => notices.push(notice));
    const started = await runtime.generation.start('article.draft', { productionId: production.id, pieceId: article.id });
    assert.ok(started.ok, started.ok ? '' : started.refusal.message);
    await finish(runtime, started.value.runId);

    const settled = await detail(runtime, production.id);
    const latest = settled.pieces.find((piece) => piece.kind === 'article')?.latestVersion;
    assert.equal(latest?.origin, 'generation');
    assert.equal(latest?.runId, started.value.runId);
    assert.ok(notices.some((notice) => notice.scope === 'runs' && notice.activity.includes('run.completed')));
    const model = settled.runs.find((run) => run.id === started.value.runId)?.model;
    assert.equal(model?.label, 'Simulação local');
    assert.equal(settled.runs.find((run) => run.id === started.value.runId)?.cost, undefined, 'simulated runs never show a cost');
    runtime.dispose();
  });

  it('coalesces streamed text deltas: far fewer store notices than stream events', async () => {
    const { runtime } = open();
    const notices: ChangeNotice[] = [];
    runtime.subscribe((notice) => notices.push(notice));
    const runId = runtime.simulation?.adoptedRunIds[0] ?? '';
    const attached = await runtime.generation.attach(runId);
    assert.ok(attached.ok);
    let events = 0;
    for await (const event of attached.value.events) if (event.type === 'text.delta') events += 1;
    assert.ok(events > 100, `the flagship streams many deltas (${events})`);
    assert.ok(notices.length < events / 4, `${notices.length} notices for ${events} deltas`);
    runtime.dispose();
  });

  it('closes a run a reload killed as "interrompida" and keeps its partial text', async () => {
    const storage = memoryStorage();
    const clock = manualClock(NOW);
    const first = open({ storage, clock, sleep: freezingSleep(clock, 60) });
    const runId = first.runtime.simulation?.adoptedRunIds[0] ?? '';
    const progressed = async () => {
      const attached = await first.runtime.generation.attach(runId);
      return attached.ok && attached.value.snapshot.blocks.some((block) => block.text.length > 0);
    };
    for (let tries = 0; tries < 500 && !(await progressed()); tries += 1) await new Promise<void>((resolve) => setImmediate(resolve));
    assert.ok(await progressed(), 'the run wrote some text before the tab froze');
    first.runtime.flush();
    first.runtime.dispose();
    assert.ok(storage.getItem(SNAPSHOT_KEY), 'the workspace was saved in this browser');

    const second = open({ storage, clock });
    assert.equal(second.runtime.simulation?.loadedFrom, 'snapshot');
    assert.ok(second.runtime.simulation?.recoveredRunIds.includes(runId), 'the orphan run (and its section run) are closed');
    const after = await detail(second.runtime, FLAGSHIP);
    assert.equal(after.activeRuns.length, 0);
    assert.equal(after.runs.find((run) => run.id === runId)?.status, 'cancelled');
    const latest = after.pieces.find((piece) => piece.kind === 'article')?.latestVersion;
    assert.ok(latest?.interrupted, 'the partial survives as an interrupted version');
    assert.ok((latest?.words ?? 0) > 0);
    second.runtime.dispose();
  });

  it('reopens the saved workspace on reload and the fixtures with reset', async () => {
    const storage = memoryStorage();
    const first = open({ storage });
    await finish(first.runtime, first.runtime.simulation?.adoptedRunIds[0] ?? '');
    const renamed = await first.runtime.commands.rename('prod-aurora', 'Aurora: reposição pelo app');
    assert.ok(renamed.ok);
    first.runtime.dispose();

    const reloaded = open({ storage });
    assert.equal(reloaded.runtime.simulation?.loadedFrom, 'snapshot');
    assert.equal((await detail(reloaded.runtime, 'prod-aurora')).title, 'Aurora: reposição pelo app');
    assert.deepEqual(reloaded.runtime.simulation?.adoptedRunIds, []);
    reloaded.runtime.dispose();

    const reset = open({ storage, reset: true });
    assert.equal(reset.runtime.simulation?.loadedFrom, 'fixtures');
    assert.notEqual((await detail(reset.runtime, 'prod-aurora')).title, 'Aurora: reposição pelo app');
    assert.equal(reset.runtime.simulation?.adoptedRunIds.length, 1, 'the flagship streams again');
    reset.runtime.dispose();
  });

  it('builds the export package of a concluded production and records the delivery once', async () => {
    const { runtime } = open();
    const built = await runtime.export.build({ productionId: 'prod-bella-passo' });
    assert.ok(built.ok, built.ok ? '' : built.refusal.message);
    const markdown = built.value.files.find((file) => file.format === 'md');
    assert.equal(markdown?.status, 'ready');
    assert.ok(markdown?.href?.startsWith('data:'));
    const input = { productionId: 'prod-bella-passo', selection: built.value.plan.selection, files: built.value.outcomes };
    const first = await runtime.commands.recordDelivery(input);
    const again = await runtime.commands.recordDelivery(input);
    assert.ok(first.ok && again.ok);
    assert.equal(first.value.id, again.value.id, 'the same package adds an attempt, never a new delivery');
    runtime.dispose();
  });

  it('Entrega reads the approved article even while the package mixes versions, with its images listed', async () => {
    const { runtime } = open();
    const mixed = await runtime.queries.delivery('prod-patio-couro');
    assert.ok(mixed.ok);
    assert.equal(mixed.value.result.ok, false);
    assert.equal(mixed.value.items.length, 0, 'no package to build');
    assert.equal(mixed.value.article?.kind, 'article', '"Artigo final" still has its article');
    const delivered = await runtime.queries.delivery('prod-bella-passo');
    assert.ok(delivered.ok);
    assert.equal(delivered.value.article?.versionView.number, 2);
    // The example's images are listed like uploads, credited and authorised.
    const images = runtime.assets.list('prod-bella-passo');
    assert.equal(images.length, 3);
    assert.ok(images.every((image) => image.credit && image.rights.authorized));
    runtime.dispose();
  });

  it('keeps the workspace in memory when storage is off and stops cleanly on dispose', async () => {
    const { runtime } = open({ storage: null });
    assert.equal(runtime.saveStatus.current().scope, 'memory');
    runtime.dispose();
    runtime.dispose();
    runtime.flush();
  });
});
