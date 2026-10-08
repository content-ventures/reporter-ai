import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createIdGenerator, manualClock, memoryStorage } from '../adapters/local/store/index.ts';
import { PEOPLE } from '../fixtures/people.ts';
import { createRuntime } from './create-runtime.ts';
import type { Runtime } from './runtime.ts';

/**
 * B06 · REQ-T.1: one fixture production (the Couro Nobre panel, material still waiting for its
 * release) is restricted to its team. Anyone else ("Entrar como Pedro") does not see it in any
 * read, gets `restricted` with who to ask when opening its link, and the denial enters the trail.
 */

const NOW = '2026-10-07T12:00:00.000Z';
const RESTRICTED = 'prod-couro-nobre';

function open(): Runtime {
  const clock = manualClock(NOW);
  return createRuntime({
    storage: memoryStorage(),
    ids: createIdGenerator({ salt: 'access' }),
    latency: false,
    adoptLiveRuns: false,
    sleep: async (ms) => {
      clock.advance(Math.max(0, Math.round(ms)));
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
    clock,
  });
}

async function listed(runtime: Runtime): Promise<string[]> {
  const page = await runtime.queries.list({ sort: 'updated_desc' }, { page: 1, size: 50 });
  return page.items.map((item) => item.id);
}

describe('production restricted to its team (B06)', () => {
  it('the owner (admin) and a team member open it; anyone else does not even see it', async () => {
    const runtime = open();
    assert.ok((await listed(runtime)).includes(RESTRICTED), 'João (owner, admin) sees it');
    assert.ok((await runtime.queries.get(RESTRICTED)).ok);

    assert.ok((await runtime.session.actAs?.(PEOPLE.pedro))?.ok);
    assert.ok(!(await listed(runtime)).includes(RESTRICTED), 'Pedro does not see it in the list');
    const refused = await runtime.queries.get(RESTRICTED);
    assert.equal(!refused.ok && refused.refusal.code, 'restricted');
    assert.equal(!refused.ok && refused.refusal.message, 'Esta produção é restrita à equipe dela. Peça acesso a João.');
    const activity = await runtime.queries.activity({ productionId: RESTRICTED });
    assert.equal(activity.items.length, 0, 'nor in the activity feed');
    const overview = await runtime.queries.overview('7d');
    assert.ok(!JSON.stringify(overview).includes(RESTRICTED), 'nor in the overview');

    assert.ok((await runtime.session.actAs?.(PEOPLE.clara))?.ok);
    assert.ok((await runtime.queries.get(RESTRICTED)).ok, 'Clara is on the team');
    runtime.dispose();
  });

  it('the denial enters the audit trail once per window, with the production as target', async () => {
    const runtime = open();
    assert.ok((await runtime.session.actAs?.(PEOPLE.pedro))?.ok);
    await runtime.queries.get(RESTRICTED);
    await runtime.queries.get(RESTRICTED);
    assert.ok((await runtime.session.actAs?.(PEOPLE.joao))?.ok);
    const trail = await runtime.audit.list({ types: ['access'] });
    assert.ok(trail.ok);
    const denials = trail.value.items.filter((entry) => entry.action === 'access.denied' && entry.target?.productionId === RESTRICTED);
    assert.equal(denials.length, 1);
    assert.equal(denials[0]?.actorId, PEOPLE.pedro);
    assert.equal(denials[0]?.reason, 'Esta produção é restrita à equipe dela. Peça acesso a João.');
    runtime.dispose();
  });
});
