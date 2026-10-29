import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConnectedRuntime } from './create-connected-runtime.ts';
import { createEditorialEngine, emptyEditorialCheckpoint } from './editorial-engine.ts';
import type { WorkspaceRefresh } from '../ports/connected-workspace.ts';
import type { ChangeNotice } from '../ports/common.ts';

test('connected delta reads adopt changed permissions and sources without a production change', async t => {
  const checkpoint = emptyEditorialCheckpoint();
  const engine = createEditorialEngine(checkpoint, { next: prefix => `${prefix}-${crypto.randomUUID()}` });
  const created = await engine.commands.createFromSource({ title: 'Synthetic delta acceptance', plan: ['article'],
    brief: { size: 'short', sections: 2 }, material: { text: 'Synthetic source for workspace permission changes.', authorized: true, origin: 'other', format: 'plain' } });
  assert.ok(created.ok);
  checkpoint.state = engine.store.state;
  engine.store.dispose();
  const source = checkpoint.state.sources[0], person = checkpoint.state.people.find(person => person.id === checkpoint.state.sessionPersonId)!;
  const member = checkpoint.state.members.find(member => member.personId === person.id)!;
  const empty = { productions: [], parts: [], sources: [], runs: [], events: [], items: [] };
  const replies: WorkspaceRefresh[] = [
    { ...checkpoint, revision: 1, syncToken: 'initial', model: 'synthetic', workerOnline: false, deploymentMode: 'local' },
    { ...empty, delta: true, revision: 2, syncToken: 'permissions', workerOnline: false,
      items: [{ kind: 'member', id: member.personId, doc: { ...member, roles: ['approver'] }, productionId: null }] },
    { ...empty, delta: true, revision: 3, syncToken: 'source', workerOnline: false,
      sources: [{ id: source.id, doc: { ...source, rights: { ...source.rights, authorized: false } } }] },
    { ...empty, delta: true, revision: 4, syncToken: 'person', workerOnline: false,
      items: [{ kind: 'person', id: person.id, doc: { ...person, name: 'Updated synthetic member' }, productionId: null }] },
  ];
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input), 'https://reporter.invalid');
    assert.equal(url.pathname, '/api/reporter/workspace');
    assert.equal(init?.method, 'GET', 'this regression never starts a provider or writes to a server');
    requests.push(url.search);
    const response = replies.shift(); assert.ok(response, 'only the explicitly requested reads execute');
    return Response.json(response);
  });
  const runtime = createConnectedRuntime(), notices: ChangeNotice[] = [];
  try {
    await runtime.ready;
    runtime.subscribe(notice => notices.push(notice));
    assert.ok((await runtime.session.current())?.roles.includes('editor'));
    await runtime.generation.models();
    assert.deepEqual((await runtime.session.current())?.roles, ['approver']);
    assert.equal(notices.length, 1);
    assert.deepEqual(notices[0].productionIds, [], 'a workspace change has no invented production write');
    await runtime.generation.models();
    const detail = await runtime.queries.source(source.id); assert.ok(detail.ok);
    assert.equal(detail.value.source.rights.authorized, false);
    await runtime.generation.models();
    assert.equal((await runtime.session.current())?.name, 'Updated synthetic member');
    assert.equal(notices.length, 3);
    const production = await runtime.queries.get(created.value.productionId); assert.ok(production.ok);
    assert.equal(production.value.title, 'Synthetic delta acceptance');
    assert.equal(requests.length, 4); assert.equal(replies.length, 0);
  } finally { runtime.dispose(); }
});
