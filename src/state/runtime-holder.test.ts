import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRuntime } from '../runtime/create-runtime.ts';
import type { Runtime } from '../runtime/runtime.ts';
import { createCommands } from './commands.ts';
import { createRuntimeHolder, RUNTIME_ERROR } from './runtime-holder.ts';
import type { Scheduler } from './query-store.ts';

function manualScheduler() {
  const tasks: { task: () => void; cancelled: boolean }[] = [];
  const schedule: Scheduler = (task) => {
    const entry = { task, cancelled: false };
    tasks.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  return { schedule, runAll: () => tasks.splice(0).forEach((entry) => !entry.cancelled && entry.task()) };
}

function tracked() {
  const created: { reset: boolean; runtime: Runtime; disposed: boolean }[] = [];
  const factory = ({ reset }: { reset: boolean }) => {
    const runtime = createRuntime({ storage: null, latency: false, adoptLiveRuns: false });
    const record = { reset, runtime, disposed: false };
    const dispose = runtime.dispose;
    created.push(record);
    return {
      ...runtime,
      dispose: () => {
        record.disposed = true;
        dispose();
      },
    };
  };
  return { created, factory };
}

describe('createRuntimeHolder', () => {
  it('creates nothing until started, then one runtime that survives a StrictMode remount', () => {
    const { created, factory } = tracked();
    const scheduler = manualScheduler();
    const holder = createRuntimeHolder(factory, { schedule: scheduler.schedule });
    assert.equal(holder.get().status, 'idle');
    assert.equal(created.length, 0, 'nothing runs during render');

    let changes = 0;
    holder.subscribe(() => (changes += 1));
    holder.start({ reset: true });
    const ready = holder.get();
    assert.equal(ready.status, 'ready');
    assert.equal(created[0].reset, true);
    holder.release();
    holder.start();
    scheduler.runAll();
    assert.equal(holder.get(), ready, 'effect → cleanup → effect keeps the same runtime');
    assert.equal(created.length, 1);
    assert.equal(changes, 1);

    holder.release();
    scheduler.runAll();
    assert.equal(holder.get().status, 'idle');
    assert.equal(created[0].disposed, true);
  });

  it('resets by disposing the runtime and reopening the fixtures', () => {
    const { created, factory } = tracked();
    const holder = createRuntimeHolder(factory);
    holder.start();
    holder.reset();
    assert.equal(created.length, 2);
    assert.equal(created[0].disposed, true);
    assert.equal(created[1].reset, true);
    holder.release();
  });

  it('lets commands wait for the runtime and reports a runtime that cannot open', async () => {
    const { factory } = tracked();
    const holder = createRuntimeHolder(factory);
    const commands = createCommands(() => holder.whenReady());
    const pending = commands.production.rename('prod-aurora', 'Aurora: app de reposição');
    holder.start();
    const renamed = await pending;
    assert.ok(renamed.ok);
    assert.equal(renamed.value.title, 'Aurora: app de reposição');
    const actAs = await commands.session.actAs('pessoa-inexistente');
    assert.equal(!actAs.ok && actAs.refusal.code, 'unknown_member');
    holder.reset();

    const broken = createRuntimeHolder(() => {
      throw new Error('storage blocked');
    });
    broken.start();
    const state = broken.get();
    assert.equal(state.status, 'error');
    assert.equal(state.status === 'error' && state.error, RUNTIME_ERROR);
    await assert.rejects(broken.whenReady());
  });
});
