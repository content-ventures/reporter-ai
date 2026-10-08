import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { auditTitle } from '../domain/index.ts';
import { createFixtures } from './index.ts';
import { auditAnchor, seededAuditEvents } from './audit.ts';

const NOW = '2026-10-07T15:00:00.000Z';

function seedInput(now = NOW) {
  const fixtures = createFixtures({ now });
  return {
    fixtures,
    input: {
      now,
      productions: fixtures.records.map((record) => ({ production: record.production, pieces: record.pieces, versions: record.versions })),
      sources: fixtures.records.flatMap((record) => record.sources),
    },
  };
}

describe('seeded audit history', () => {
  it('is about 60 events of the last 30 days, oldest first, with stable ids and masked IPs', () => {
    const { input } = seedInput();
    const events = seededAuditEvents(input);
    assert.ok(events.length >= 50 && events.length <= 70, `${events.length} events`);
    assert.deepEqual(events.map((event) => event.id), events.map((_, index) => `aud-s-${String(index + 1).padStart(4, '0')}`));
    for (let index = 1; index < events.length; index += 1) assert.ok(events[index - 1].at <= events[index].at, 'ascending');
    const oldest = Date.parse(NOW) - 31 * 24 * 60 * 60 * 1000;
    for (const event of events) {
      assert.ok(Date.parse(event.at) < Date.parse(NOW) && Date.parse(event.at) > oldest, event.id);
      if (event.origin.ip) assert.match(event.origin.ip, /•••/);
      if (event.result !== 'success') assert.ok(event.reason, `${event.id} says why`);
      assert.ok(!auditTitle(event.action, event.result).includes(' · '), `${event.action}/${event.result} has its own pt-BR line`);
    }
    assert.deepEqual(seededAuditEvents(input), events, 'deterministic');
  });

  it('never dates an update before its production existed', () => {
    const { input } = seedInput();
    const created = new Map(input.productions.map((entry) => [entry.production.id, entry.production.createdAt]));
    for (const event of seededAuditEvents(input)) {
      const productionId = event.target?.productionId;
      if (productionId) assert.ok(event.at > (created.get(productionId) ?? ''), event.id);
    }
  });

  it('anchors to the fixture clock the workspace was created with', () => {
    const { fixtures } = seedInput();
    assert.equal(auditAnchor(fixtures.workspace), NOW);
  });

  it('is empty for a workspace without productions', () => {
    assert.deepEqual(seededAuditEvents({ now: NOW, productions: [], sources: [] }), []);
  });
});
