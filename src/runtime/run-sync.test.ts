import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RunEvent, RunFold } from '../domain/run-events.ts';
import type { RunMeta, RunUpdate } from '../ports/generation.ts';
import { createRunSync } from './run-sync.ts';
import type { Scheduler } from './run-sync.ts';

function manualScheduler() {
  const tasks: { task: () => void; ms: number; cancelled: boolean }[] = [];
  const schedule: Scheduler = (task, ms) => {
    const entry = { task, ms, cancelled: false };
    tasks.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  const runAll = () => {
    for (const entry of tasks.splice(0)) if (!entry.cancelled) entry.task();
  };
  return { schedule, runAll, pending: () => tasks.filter((entry) => !entry.cancelled).length };
}

function update(runId: string, seq: number, type: RunEvent['type']): RunUpdate {
  const meta = { runId, productionId: 'prod-1', pieceId: 'piece-1', label: 'Geração do artigo' } as unknown as RunMeta;
  const event = { type, runId, seq, at: '2026-10-07T12:00:00.000Z' } as unknown as RunEvent;
  return { event, fold: { seq } as unknown as RunFold, meta };
}

describe('createRunSync', () => {
  it('applies structural events at once and in order', () => {
    const applied: number[] = [];
    const sync = createRunSync((entry) => applied.push(entry.event.seq), { schedule: manualScheduler().schedule });
    sync.push(update('run-1', 1, 'run.started'));
    sync.push(update('run-1', 2, 'step.started'));
    sync.push(update('run-1', 3, 'block.completed'));
    assert.deepEqual(applied, [1, 2, 3]);
  });

  it('coalesces text deltas per run and drops them when a structural event arrives first', () => {
    const scheduler = manualScheduler();
    const applied: string[] = [];
    const sync = createRunSync((entry) => applied.push(`${entry.meta.runId}:${entry.event.seq}`), { schedule: scheduler.schedule });
    sync.push(update('run-1', 4, 'text.delta'));
    sync.push(update('run-1', 5, 'text.delta'));
    sync.push(update('run-2', 9, 'text.delta'));
    assert.deepEqual(applied, []);
    assert.equal(scheduler.pending(), 1, 'one timer for every pending delta');
    sync.push(update('run-1', 6, 'block.completed'));
    assert.deepEqual(applied, ['run-1:6'], 'the delta is superseded by the next fold');
    scheduler.runAll();
    assert.deepEqual(applied, ['run-1:6', 'run-2:9'], 'only the latest delta of each run is applied');
  });

  it('flushes pending deltas on demand and ignores everything after dispose', () => {
    const scheduler = manualScheduler();
    const applied: number[] = [];
    const sync = createRunSync((entry) => applied.push(entry.event.seq), { schedule: scheduler.schedule });
    sync.push(update('run-1', 7, 'text.delta'));
    sync.flush();
    assert.deepEqual(applied, [7]);
    sync.push(update('run-1', 8, 'text.delta'));
    sync.dispose();
    scheduler.runAll();
    sync.push(update('run-1', 9, 'run.completed'));
    assert.deepEqual(applied, [7]);
  });

  it('keeps streaming when a write throws', () => {
    const applied: number[] = [];
    const sync = createRunSync((entry) => {
      if (entry.event.seq === 2) throw new Error('quota');
      applied.push(entry.event.seq);
    });
    sync.push(update('run-1', 1, 'run.started'));
    sync.push(update('run-1', 2, 'step.started'));
    sync.push(update('run-1', 3, 'step.completed'));
    assert.deepEqual(applied, [1, 3]);
    sync.dispose();
  });
});
