import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { newProductionInput } from '../../../ports/contracts/fixture.ts';
import { memoryStorage } from './storage.ts';
import { createTestPorts, TEST_PEOPLE } from './testing.ts';
import type { TestPorts } from './testing.ts';

/** A11 (REQ-T.8): 👍/👎 are stored, one per person and target, and survive a reload. */

async function production(ports: TestPorts) {
  const result = await ports.commands.createFromSource(newProductionInput());
  assert.ok(result.ok);
  return result.value.productionId;
}

describe('votes on AI output', () => {
  it('stores a vote with its category, replaces it when switched and survives a reload', async () => {
    const storage = memoryStorage();
    const ports = createTestPorts({ storage });
    const productionId = await production(ports);
    const target = { kind: 'production' as const, productionId };

    const up = await ports.feedback.vote({ target, value: 'up' });
    assert.ok(up.ok && up.value);
    assert.equal(up.value.vote, 'up');
    assert.equal(up.value.rating, 'positive');
    assert.equal(up.value.category, undefined);

    const down = await ports.feedback.vote({ target, value: 'down' });
    assert.ok(down.ok && down.value);
    assert.equal(down.value.id, up.value.id, 'the vote is replaced, not duplicated');
    assert.equal(down.value.category, 'improvement', 'a 👎 is filed as an improvement by default');
    const noted = await ports.feedback.vote({ target, value: 'down', note: 'Faltou a cifra do faturamento', category: 'error' });
    assert.ok(noted.ok && noted.value);
    assert.equal(noted.value.note, 'Faltou a cifra do faturamento');
    assert.equal(noted.value.category, 'error');

    const mine = await ports.feedback.list({ target, mine: true, votes: true });
    assert.equal(mine.length, 1);
    assert.equal(mine[0].vote, 'down');

    const reloaded = createTestPorts({ storage });
    const after = await reloaded.feedback.list({ target, mine: true, votes: true });
    assert.equal(after.length, 1, 'the vote is still there after a reload');
    assert.equal(after[0].vote, 'down');
    assert.equal(after[0].note, 'Faltou a cifra do faturamento');
  });

  it('keeps one vote per person, takes it back with null, and refuses unknown targets', async () => {
    const ports = createTestPorts();
    const productionId = await production(ports);
    const target = { kind: 'production' as const, productionId };
    assert.ok((await ports.feedback.vote({ target, value: 'up' })).ok);
    assert.ok((await ports.session.actAs?.(TEST_PEOPLE.approver))?.ok);
    assert.ok((await ports.feedback.vote({ target, value: 'down' })).ok);
    assert.equal((await ports.feedback.list({ target, votes: true })).length, 2, 'each person has their own vote');
    assert.equal((await ports.feedback.list({ target, mine: true, votes: true }))[0].vote, 'down');

    const cleared = await ports.feedback.vote({ target, value: null });
    assert.ok(cleared.ok);
    assert.equal(cleared.value, null);
    assert.deepEqual(await ports.feedback.list({ target, mine: true, votes: true }), []);
    assert.equal((await ports.feedback.list({ target, votes: true })).length, 1, "the other person's vote stays");

    const unknown = await ports.feedback.vote({ target: { kind: 'run', runId: 'run-nobody' }, value: 'up' });
    assert.equal(!unknown.ok && unknown.refusal.code, 'not_found');
  });

  it('never mixes votes with the pilot feedback of the same target', async () => {
    const ports = createTestPorts();
    const productionId = await production(ports);
    const target = { kind: 'production' as const, productionId };
    assert.ok((await ports.feedback.record({ target, rating: 'mixed', note: 'Precisou de ajuste' })).ok);
    assert.ok((await ports.feedback.vote({ target, value: 'up' })).ok);
    assert.ok((await ports.feedback.vote({ target, value: null })).ok);
    const left = await ports.feedback.list({ target });
    assert.equal(left.length, 1);
    assert.equal(left[0].rating, 'mixed');
  });
});
