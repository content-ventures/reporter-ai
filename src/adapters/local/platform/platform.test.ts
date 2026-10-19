import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEMO_OPERATOR_ID, DEMO_WORKSPACE, demoLog, demoPeople, demoUsageFacts } from '../../../fixtures/platform.ts';
import { platformContract } from '../../../ports/contracts/platform.contract.ts';
import { createDemoPlatform, PLATFORM_DEMO_KEY } from './index.ts';

const NOW = '2026-10-19T12:00:00.000Z';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

function demo(storage = memoryStorage()) {
  let now = Date.parse(NOW);
  const sut = createDemoPlatform({
    now: () => new Date(now).toISOString(),
    seed: (at) => ({ operatorId: DEMO_OPERATOR_ID, workspaces: [DEMO_WORKSPACE], people: demoPeople(at), log: demoLog(at), facts: demoUsageFacts(at) }),
    storage,
  });
  return { ...sut, storage, advance: (ms: number) => { now += ms; } };
}

platformContract(() => demo());

describe('demo platform console', () => {
  it('releases a self sign-up with the roles chosen', async () => {
    const { console: platform } = demo();
    const directory = await platform.directory();
    assert.ok(directory.ok);
    const pending = directory.value.people.find((person) => person.status === 'pending');
    assert.ok(pending);
    const approved = await platform.approve(pending.id, ['editor']);
    assert.equal(approved.ok && approved.value.status, 'active');
    const again = await platform.approve(pending.id, ['editor']);
    assert.equal(again.ok ? undefined : again.refusal.code, 'invalid_state');
  });

  it('keeps people, links and the log across a reload of the page', async () => {
    const storage = memoryStorage();
    const first = demo(storage);
    const issued = await first.console.invite({ name: 'Lia Moraes', email: 'lia@exemplo.com', role: 'editor', workspaceId: DEMO_WORKSPACE.id });
    assert.ok(issued.ok);
    assert.ok(storage.data.has(PLATFORM_DEMO_KEY));
    const second = demo(storage);
    const preview = await second.invites.preview(issued.value.token);
    assert.equal(preview.ok && preview.value.email, 'lia@exemplo.com');
  });

  it('draws the same usage history on every visit', () => {
    assert.deepEqual(demoUsageFacts(NOW), demoUsageFacts(NOW));
    assert.ok(demoUsageFacts(NOW).generations.length > 100);
  });
});
