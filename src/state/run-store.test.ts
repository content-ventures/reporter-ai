import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { manualClock } from '../adapters/local/store/index.ts';
import type { RunUpdate } from '../ports/generation.ts';
import { createRuntime } from '../runtime/create-runtime.ts';
import { isTerminalUpdate } from './run-outcome.ts';
import { createRunStore } from './run-store.ts';
import type { RunState } from './run-store.ts';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function streamingRuntime() {
  const clock = manualClock('2026-10-07T12:00:00.000Z');
  return createRuntime({
    clock,
    storage: null,
    latency: false,
    sleep: async (ms) => {
      clock.advance(ms);
      await tick();
    },
  });
}

async function until(check: () => boolean, tries = 2000): Promise<void> {
  for (let attempt = 0; attempt < tries && !check(); attempt += 1) await tick();
  assert.ok(check(), 'condition reached');
}

describe('createRunStore', () => {
  it('attaches to a live run, follows its folds to the end and forwards every update', async () => {
    const runtime = streamingRuntime();
    const runs = createRunStore(runtime.generation);
    const runId = runtime.simulation?.adoptedRunIds[0] ?? '';
    const entry = runs.entry(runId);
    assert.equal(entry.snapshot().status, 'loading');

    const states: RunState[] = [];
    entry.subscribe(() => {
      const snapshot = entry.snapshot();
      if (snapshot.status === 'ready') states.push(snapshot.data);
    });
    const updates: RunUpdate[] = [];
    entry.listen((update) => updates.push(update));

    await until(() => entry.snapshot().data?.live === false);
    const final = entry.snapshot();
    assert.equal(final.status, 'ready');
    assert.equal(final.data?.fold.run.status, 'completed');
    assert.ok(states[0].live, 'starts live, from the attach snapshot');
    assert.ok(states.every((state, index) => index === 0 || state.fold.seq > states[index - 1].fold.seq), 'folds only move forward');
    assert.ok(updates.some((update) => update.event.type === 'text.delta'), 'listeners get the text deltas');
    assert.ok(updates.some(isTerminalUpdate), 'and the terminal event');
    runs.dispose();
    runtime.dispose();
  });

  it('re-renders watchers at most once per window for text deltas, but every update reaches listeners', async () => {
    const runtime = streamingRuntime();
    const pending: (() => void)[] = [];
    // Manual scheduler: coalesced notifications fire only when the test flushes them.
    const runs = createRunStore(runtime.generation, { schedule: (task) => (pending.push(task), () => undefined) });
    const entry = runs.entry(runtime.simulation?.adoptedRunIds[0] ?? '');
    let watched = 0;
    entry.subscribe(() => {
      watched += 1;
    });
    let deltas = 0;
    entry.listen((update) => {
      if (update.event.type === 'text.delta') deltas += 1;
    });
    await until(() => deltas >= 5);
    const before = watched;
    assert.ok(pending.length <= 1 + 1, 'one pending notification for a burst of deltas');
    for (const task of pending.splice(0)) task();
    assert.ok(watched <= before + 1);
    assert.ok(deltas > watched, 'listeners get every delta; watchers far fewer notifications');
    runs.dispose();
    runtime.dispose();
  });

  it('answers unknown_run for runs that are not live in this session', async () => {
    const runtime = streamingRuntime();
    const runs = createRunStore(runtime.generation);
    const entry = runs.entry('run-de-outra-sessao');
    entry.subscribe(() => {});
    await tick();
    const snapshot = entry.snapshot();
    assert.equal(snapshot.status, 'error');
    assert.equal(snapshot.error?.code, 'unknown_run');
    runs.dispose();
    runtime.dispose();
  });
});
