import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ok } from '../domain/result.ts';
import type { Runtime, TabState } from '../runtime/runtime.ts';
import { createCommands } from './commands.ts';

/** A10: a tab that another tab took over is read-only until "Usar esta aba". */

function fakeRuntime(state: { tab: TabState; claimed: number }): Runtime {
  return {
    tabs: {
      current: () => state.tab,
      subscribe: () => () => undefined,
      claim: () => {
        state.claimed += 1;
        state.tab = { status: 'active' };
      },
    },
    commands: { rename: async (_id: string, title: string) => ok({ title }) },
    generation: { cancel: async () => ok({}) },
    feedback: { vote: async () => ok(null) },
  } as unknown as Runtime;
}

describe('commands while another tab owns the workspace', () => {
  it('refuses writes with read_only, lets "Parar" through, and edits again after "Usar esta aba"', async () => {
    const state: { tab: TabState; claimed: number } = { tab: { status: 'elsewhere', reason: 'same-draft', since: '2026-10-07T12:00:00.000Z' }, claimed: 0 };
    const runtime = fakeRuntime(state);
    const commands = createCommands(async () => runtime);

    const refused = await commands.production.rename('prod-1', 'Novo título');
    assert.equal(!refused.ok && refused.refusal.code, 'read_only');
    const vote = await commands.feedback.vote({ target: { kind: 'run', runId: 'run-1' }, value: 'up' });
    assert.equal(!vote.ok && vote.refusal.code, 'read_only');
    assert.ok((await commands.generation.cancel('run-1')).ok, 'stopping a run is never blocked');

    await commands.tabs.claim();
    assert.equal(state.claimed, 1);
    const renamed = await commands.production.rename('prod-1', 'Novo título');
    assert.ok(renamed.ok);
  });
});
