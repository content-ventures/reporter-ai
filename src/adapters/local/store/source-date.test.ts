import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditFromActivity } from '../audit/from-activity.ts';
import { writingTemporalContext } from '../../../domain/writing-context.ts';
import { newProductionInput } from '../../../ports/contracts/fixture.ts';
import { editorialContextHash } from '../../../runtime/editorial-engine.ts';
import { memoryStorage } from './storage.ts';
import { createTestPorts, TEST_PEOPLE } from './testing.ts';

test('source dates update every authorized production, persist audited before/after values, and invalidate only new context', async () => {
  const storage = memoryStorage();
  const ports = createTestPorts({ storage });
  const first = await ports.commands.createFromSource(newProductionInput());
  assert.ok(first.ok);
  const second = await ports.commands.createFromSource(newProductionInput({ title: 'Outra pauta', reuseSourceId: first.value.sourceId }));
  assert.ok(second.ok);
  const before = structuredClone(ports.store.state.sources[0]);
  const oldContext = writingTemporalContext([before], '2026-10-21');
  const record = ports.records.record(first.value.productionId)!;
  const oldHash = editorialContextHash(record, first.value.pieces[0].pieceId, []);
  ports.clock.advance(1000);
  const result = await ports.commands.updateSourceRecordedOn(before.id, '2026-05-20', null);
  assert.deepEqual(result, { ok: true, value: { recordedOn: '2026-05-20' } });
  assert.deepEqual(ports.store.state.sources[0], { ...before, recordedOn: '2026-05-20' }, 'transcript, permissions and other metadata stay intact');
  assert.notEqual(editorialContextHash(ports.records.record(first.value.productionId)!, first.value.pieces[0].pieceId, []), oldHash);
  assert.equal(oldContext.sources[0].recordedOn, null, 'historical prompt snapshots retain their original date');
  const events = ports.store.state.activity.filter(event => event.type === 'source.date_updated');
  assert.deepEqual(events.map(event => event.productionId), [first.value.productionId, second.value.productionId]);
  for (const event of events) {
    assert.equal(event.actorId, TEST_PEOPLE.editor);
    assert.equal(event.at, ports.clock.now());
    assert.deepEqual(event.data, { title: before.title, before: '', after: '2026-05-20' });
    const audit = auditFromActivity(event, { pieceKind: () => undefined });
    assert.equal(audit?.action, 'source.updated');
    assert.deepEqual(audit?.changes, [{ field: 'Data do material', before: 'Não informada', after: '2026-05-20' }]);
    assert.equal(ports.records.record(event.productionId!)!.production.updatedAt, ports.clock.now());
  }
  assert.ok((await ports.commands.updateSourceRecordedOn(before.id, '2026-05-20', '2026-05-20')).ok);
  assert.equal(ports.store.state.activity.filter(event => event.type === 'source.date_updated').length, 2, 'saving the same value adds no activity');
  assert.ok((await ports.commands.updateSourceRecordedOn(before.id, null, '2026-05-20')).ok);
  assert.deepEqual(ports.store.state.sources[0], before, 'null clears only the date');
  assert.deepEqual(ports.store.state.activity.at(-1)?.data, { title: before.title, before: '2026-05-20', after: '' });
  ports.store.dispose();
  const reopened = createTestPorts({ storage });
  assert.deepEqual(reopened.store.state.sources[0], before);
  assert.equal(reopened.store.state.activity.filter(event => event.type === 'source.date_updated').length, 4);
  reopened.store.dispose();
});

test('invalid or missing dates and stale base dates refuse the whole update without side effects', async () => {
  const ports = createTestPorts();
  const created = await ports.commands.createFromSource(newProductionInput());
  assert.ok(created.ok);
  const id = created.value.sourceId;
  const before = structuredClone(ports.store.state);
  for (const value of ['', '2026-02-30', '20/05/2026', '2026-5-20', undefined, 42]) {
    const result = await ports.commands.updateSourceRecordedOn(id, value as string, null);
    assert.equal(!result.ok && result.refusal.code, 'invalid_date');
    assert.deepEqual(ports.store.state, before);
  }
  assert.ok((await ports.commands.updateSourceRecordedOn(id, '2026-05-20', null)).ok);
  const saved = structuredClone(ports.store.state);
  const conflict = await ports.commands.updateSourceRecordedOn(id, '2026-05-21', null);
  assert.equal(!conflict.ok && conflict.refusal.code, 'conflict');
  assert.deepEqual(ports.store.state, saved);
  assert.equal(ports.store.state.sources[0].recordedOn, '2026-05-20');
  ports.store.dispose();
});

test('source dates require edit permission and access to every production sharing the source', async () => {
  const ports = createTestPorts();
  const first = await ports.commands.createFromSource(newProductionInput());
  assert.ok(first.ok);
  const second = await ports.commands.createFromSource(newProductionInput({ reuseSourceId: first.value.sourceId }));
  assert.ok(second.ok);
  await ports.session.actAs?.(TEST_PEOPLE.approver);
  const before = structuredClone(ports.store.state);
  const denied = await ports.commands.updateSourceRecordedOn(first.value.sourceId, '2026-05-20', null);
  assert.equal(!denied.ok && denied.refusal.code, 'forbidden');
  assert.deepEqual(ports.store.state, before);
  await ports.session.actAs?.(TEST_PEOPLE.editorOnly);
  ports.records.apply(second.value.productionId, record => ({ ...record, production: { ...record.production, restrictedTo: [] } }));
  const restricted = structuredClone(ports.store.state);
  const shared = await ports.commands.updateSourceRecordedOn(first.value.sourceId, '2026-05-20', null);
  assert.equal(!shared.ok && shared.refusal.code, 'forbidden');
  assert.deepEqual(ports.store.state, restricted);
  const missing = await ports.commands.updateSourceRecordedOn('unknown-source', null, null);
  assert.equal(!missing.ok && missing.refusal.code, 'not_found');
  ports.store.dispose();
});
