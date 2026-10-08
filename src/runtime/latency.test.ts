import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProductionQueries } from '../ports/production-queries.ts';
import { DEFAULT_LATENCY, withFirstLoadLatency } from './latency.ts';

describe('withFirstLoadLatency', () => {
  it('delays only the first read of each query and arguments, within 150–300 ms', async () => {
    const waits: number[] = [];
    const calls: string[] = [];
    const read = (name: string) => async (...args: unknown[]) => void calls.push([name, ...args.filter((arg) => arg !== undefined)].join(':'));
    const base = Object.fromEntries(
      ['list', 'get', 'overview', 'activity', 'people', 'draft', 'version', 'compare', 'source', 'review', 'delivery'].map((name) => [name, read(name)]),
    );
    const queries = withFirstLoadLatency({ ...base, subscribe: () => () => {} } as unknown as ProductionQueries, { ...DEFAULT_LATENCY, random: () => 0.5, sleep: async (ms) => void waits.push(ms) });
    await queries.list();
    await queries.list(undefined);
    await queries.get('prod-1');
    await queries.get('prod-1');
    await queries.get('prod-2');
    assert.deepEqual(waits, [225, 225, 225]);
    assert.deepEqual(calls, ['list', 'list', 'get:prod-1', 'get:prod-1', 'get:prod-2']);
    assert.equal(typeof queries.subscribe, 'function');
  });
});
