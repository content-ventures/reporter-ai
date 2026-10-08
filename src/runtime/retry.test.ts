import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createIdGenerator, manualClock, memoryStorage } from '../adapters/local/store/index.ts';
import type { KeyValueStorage, ManualClock } from '../adapters/local/store/index.ts';
import type { RunId } from '../domain/ids.ts';
import type { ProductionDetail } from '../ports/production-queries.ts';
import { createRuntime } from './create-runtime.ts';
import type { ContinueRunsOptions, CreateRuntimeOptions } from './create-runtime.ts';
import type { Runtime } from './runtime.ts';

/**
 * A04: a failed or interrupted generation keeps its text and continues from the failed step,
 * whether the run belongs to this session, to the fixtures, or to a page load a reload killed.
 */

const NOW = '2026-10-07T12:00:00.000Z';
const HORIZONTE = 'prod-horizonte';
const FLAGSHIP = 'prod-atelie-sul';
const REUSED = 'Reaproveitado da tentativa anterior';

function instantSleep(clock: ManualClock) {
  return async (ms: number) => {
    clock.advance(Math.max(0, Math.round(ms)));
    await new Promise<void>((resolve) => setImmediate(resolve));
  };
}

/** Delays pass instantly until `frozen()` turns true; then they hang until the run is aborted (a frozen tab). */
function freezingSleep(clock: ManualClock, frozen: () => boolean) {
  return (ms: number, signal: AbortSignal) => {
    if (!frozen()) return instantSleep(clock)(ms);
    return new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
  };
}

let loads = 0;

function open(options: Partial<CreateRuntimeOptions> & { clock?: ManualClock; storage?: KeyValueStorage } = {}): Runtime {
  const clock = options.clock ?? manualClock(NOW);
  return createRuntime({
    storage: memoryStorage(),
    ids: createIdGenerator({ salt: `retry${(loads += 1)}` }),
    latency: false,
    sleep: instantSleep(clock),
    adoptLiveRuns: false,
    ...options,
    clock,
  });
}

async function finish(runtime: Runtime, runId: RunId) {
  const attached = await runtime.generation.attach(runId);
  assert.ok(attached.ok, 'the run is attached');
  for await (const event of attached.value.events) void event;
}

async function detail(runtime: Runtime, productionId: string): Promise<ProductionDetail> {
  const found = await runtime.queries.get(productionId);
  assert.ok(found.ok, `production ${productionId}`);
  return found.value;
}

function article(production: ProductionDetail) {
  const piece = production.pieces.find((entry) => entry.kind === 'article');
  assert.ok(piece, 'article piece');
  return piece;
}

describe('retrying a generation from the failed step', () => {
  it('continues the seeded failed run (Horizonte) and keeps the sections it had written', async () => {
    const runtime = open();
    const before = await detail(runtime, HORIZONTE);
    assert.equal(before.status, 'failed');
    assert.equal(article(before).status, 'failed');
    assert.equal(article(before).latestVersion?.label, 'v1 · interrompida');
    const failed = before.runs.find((run) => run.status === 'failed');
    assert.ok(failed);

    const attached = await runtime.generation.attach(failed.id);
    assert.ok(attached.ok, 'a run of an earlier session attaches from its saved snapshot');
    assert.equal(attached.value.snapshot.run.status, 'failed');
    assert.equal(attached.value.snapshot.run.steps.find((step) => step.id === 'section-2')?.state, 'error');

    const retried = await runtime.generation.retry(failed.id, 'section-2');
    assert.ok(retried.ok, retried.ok ? '' : retried.refusal.message);
    await finish(runtime, retried.value.runId);

    const after = await detail(runtime, HORIZONTE);
    const run = after.runs.find((entry) => entry.id === retried.value.runId);
    assert.equal(run?.status, 'completed');
    assert.equal(run?.retryOfRunId, failed.id);
    for (const stepId of ['read', 'select', 'outline', 'intro', 'section-1']) {
      assert.equal(run?.steps.find((step) => step.id === stepId)?.meta, REUSED, `${stepId} is reused, not written again`);
    }
    const latest = article(after).latestVersion;
    assert.equal(latest?.label, 'v2 · IA');
    const draft = await runtime.queries.draft(article(after).id);
    assert.ok(draft.ok && draft.value.body.type === 'article');
    const ids = draft.value.body.type === 'article' ? draft.value.body.blocks.map((block) => block.id) : [];
    for (const id of ['gh-intro-1', 'gh-h1', 'gh-s1-p1', 'gh-h2', 'gh-s2-p1', 'gh-s2-p3']) assert.ok(ids.includes(id), `${id} in the new version`);
    assert.notEqual(after.status, 'failed');
    runtime.dispose();
  });

  it('gives a live failure the same status as the seeded one, and continues it', async () => {
    const runtime = open();
    const production = await detail(runtime, 'prod-couro-nobre');
    const authorised = await runtime.commands.setMaterialAuthorization(production.sources[0].id, true);
    assert.ok(authorised.ok);
    const started = await runtime.generation.start('article.draft', { productionId: production.id, pieceId: article(production).id }, { simulation: 'fail-section' });
    assert.ok(started.ok);
    await finish(runtime, started.value.runId);

    const failed = await detail(runtime, production.id);
    const seeded = await detail(runtime, HORIZONTE);
    assert.equal(failed.status, seeded.status);
    assert.equal(article(failed).status, article(seeded).status);
    assert.equal(article(failed).latestVersion?.interrupted, true);

    const retried = await runtime.generation.retry(started.value.runId);
    assert.ok(retried.ok, retried.ok ? '' : retried.refusal.message);
    await finish(runtime, retried.value.runId);
    assert.equal((await detail(runtime, production.id)).runs.find((run) => run.id === retried.value.runId)?.status, 'completed');
    runtime.dispose();
  });

  it('continues a run a reload interrupted, reusing what it had finished', async () => {
    const storage = memoryStorage();
    const clock = manualClock(NOW);
    const holder: { runtime?: Runtime } = {};
    const sectionDone = () => {
      const snapshot = holder.runtime?.generation.snapshots({ productionId: FLAGSHIP, activeOnly: true }).find((entry) => !entry.meta.child);
      return snapshot?.fold.run.steps.some((step) => step.id === 'section-1' && step.state === 'done') ?? false;
    };
    const first = open({ storage, clock, sleep: freezingSleep(clock, sectionDone), adoptLiveRuns: true });
    holder.runtime = first;
    const runId = first.simulation?.adoptedRunIds[0] ?? '';
    const progressed = async () => {
      const attached = await first.generation.attach(runId);
      return attached.ok && attached.value.snapshot.run.steps.some((step) => step.id === 'section-1' && step.state === 'done');
    };
    for (let tries = 0; tries < 5000 && !(await progressed()); tries += 1) await new Promise<void>((resolve) => setImmediate(resolve));
    assert.ok(await progressed(), 'the run finished section 1 before the tab froze');
    first.flush();
    first.dispose();

    const second = open({ storage, clock });
    assert.ok(second.simulation?.recoveredRunIds.includes(runId));
    const interrupted = await detail(second, FLAGSHIP);
    assert.equal(interrupted.runs.find((run) => run.id === runId)?.status, 'cancelled');
    assert.equal(article(interrupted).latestVersion?.interrupted, true);
    assert.equal(article(interrupted).status, 'draft', 'a run the reload stopped is not a failure');

    const attached = await second.generation.attach(runId);
    assert.ok(attached.ok, 'the interrupted run attaches after the reload');
    assert.equal(attached.value.snapshot.run.status, 'cancelled');
    const retried = await second.generation.retry(runId);
    assert.ok(retried.ok, retried.ok ? '' : retried.refusal.message);
    await finish(second, retried.value.runId);

    const after = await detail(second, FLAGSHIP);
    const run = after.runs.find((entry) => entry.id === retried.value.runId);
    assert.equal(run?.status, 'completed');
    assert.equal(run?.steps.find((step) => step.id === 'section-1')?.meta, REUSED);
    assert.equal(article(after).latestVersion?.origin, 'generation');
    assert.equal(article(after).latestVersion?.interrupted, false);
    second.dispose();
  });

  it('refuses to continue a run of an earlier session whose brief changed since, and says why', async () => {
    const storage = memoryStorage();
    const first = open({ storage });
    const production = await detail(first, 'prod-couro-nobre');
    assert.ok((await first.commands.setMaterialAuthorization(production.sources[0].id, true)).ok);
    const started = await first.generation.start('article.draft', { productionId: production.id, pieceId: article(production).id }, { simulation: 'fail-section' });
    assert.ok(started.ok);
    await finish(first, started.value.runId);
    first.flush();
    first.dispose();

    const second = open({ storage });
    const reopened = await detail(second, production.id);
    const brief = await second.commands.updateBrief(production.id, { sections: 2, length: 'short' }, reopened.brief.revision);
    assert.ok(brief.ok);
    const attached = await second.generation.attach(started.value.runId);
    assert.ok(attached.ok, 'the run still shows');
    assert.equal(attached.value.meta.canRetry, false, 'screens know it cannot continue');
    const retried = await second.generation.retry(started.value.runId);
    assert.equal(!retried.ok && retried.refusal.code, 'plan_changed');
    second.dispose();
  });

  it('a reload never interrupts a generation: the run continues in place, same run, no interrupted version', async () => {
    const storage = memoryStorage();
    const clock = manualClock(NOW);
    const timers = manualTimers();
    const holder: { runtime?: Runtime } = {};
    const sectionDone = () => {
      const snapshot = holder.runtime?.generation.snapshots({ productionId: FLAGSHIP, activeOnly: true }).find((entry) => !entry.meta.child);
      return snapshot?.fold.run.steps.some((step) => step.id === 'section-1' && step.state === 'done') ?? false;
    };
    const first = open({ storage, clock, sleep: freezingSleep(clock, sectionDone), adoptLiveRuns: true, continueRuns: timers.tab('tab-a') });
    holder.runtime = first;
    const runId = first.simulation?.adoptedRunIds[0] ?? '';
    for (let tries = 0; tries < 5000 && !sectionDone(); tries += 1) await new Promise<void>((resolve) => setImmediate(resolve));
    assert.ok(sectionDone(), 'section 1 was written before the reload');
    await timers.beat();
    first.flush();
    first.dispose();

    // The same tab reloads (its id lives in sessionStorage).
    const second = open({ storage, clock, continueRuns: timers.tab('tab-a') });
    await timers.beat();
    assert.deepEqual(second.simulation?.recoveredRunIds, [], 'nothing closed as "interrompida"');
    assert.ok(second.simulation?.adoptedRunIds.includes(runId), 'the run goes on in this tab');
    await finish(second, runId);
    const after = await detail(second, FLAGSHIP);
    const run = after.runs.find((entry) => entry.id === runId);
    assert.equal(run?.status, 'completed');
    assert.equal(after.activeRuns.length, 0, 'the section run of the earlier page load is closed too');
    assert.ok(after.runs.filter((entry) => entry.parentRunId === runId).every((entry) => entry.status !== 'running'));
    assert.equal(article(after).latestVersion?.interrupted, false);
    assert.equal(article(after).latestVersion?.runId, runId);
    assert.equal(after.pieces.flatMap((piece) => piece.versions ?? []).filter((version) => version.interrupted).length, 0);
    second.dispose();
  });

  it('a new tab leaves the generation another tab is writing alone, and takes it over when that tab closes', async () => {
    const storage = memoryStorage();
    const clock = manualClock(NOW);
    const timers = manualTimers();
    const holder: { runtime?: Runtime } = {};
    const sectionDone = () => {
      const snapshot = holder.runtime?.generation.snapshots({ productionId: FLAGSHIP, activeOnly: true }).find((entry) => !entry.meta.child);
      return snapshot?.fold.run.steps.some((step) => step.id === 'section-1' && step.state === 'done') ?? false;
    };
    const tabA = open({ storage, clock, sleep: freezingSleep(clock, sectionDone), adoptLiveRuns: true, continueRuns: timers.tab('tab-a') });
    holder.runtime = tabA;
    const runId = tabA.simulation?.adoptedRunIds[0] ?? '';
    for (let tries = 0; tries < 5000 && !sectionDone(); tries += 1) await new Promise<void>((resolve) => setImmediate(resolve));
    await timers.beat();
    tabA.flush();

    const tabB = open({ storage, clock, continueRuns: timers.tab('tab-b') });
    await timers.beat();
    assert.deepEqual(tabB.simulation?.recoveredRunIds, [], 'tab B never interrupts tab A');
    assert.equal(tabB.simulation?.adoptedRunIds.includes(runId), false);
    assert.equal((await detail(tabB, FLAGSHIP)).activeRuns.length, 1, 'tab B shows it as running');

    tabA.dispose();
    await timers.beat();
    assert.equal(tabB.simulation?.adoptedRunIds.includes(runId), false, 'tab A may still come back (reload)');
    timers.advance(4_000);
    await timers.beat();
    assert.ok(tabB.simulation?.adoptedRunIds.includes(runId), 'tab A closed: tab B continues the run');
    await finish(tabB, runId);
    assert.equal((await detail(tabB, FLAGSHIP)).runs.find((entry) => entry.id === runId)?.status, 'completed');
    tabB.dispose();
  });
});

/** Timers and a wall clock the test drives: `beat()` runs the lease ticks and their confirmations. */
function manualTimers() {
  let wall = 1_000_000;
  const ticks = new Set<() => void>();
  const pending: (() => void)[] = [];
  const settle = async () => {
    for (let round = 0; round < 20; round += 1) await new Promise<void>((resolve) => setImmediate(resolve));
  };
  return {
    advance(ms: number) {
      wall += ms;
    },
    tab(tab: string): ContinueRunsOptions {
      return {
        tab,
        now: () => wall,
        every: (tick) => {
          ticks.add(tick);
          return () => ticks.delete(tick);
        },
        later: (task) => {
          pending.push(task);
        },
      };
    },
    async beat() {
      await settle();
      for (const tick of [...ticks]) tick();
      while (pending.length > 0) pending.shift()?.();
      await settle();
    },
  };
}
