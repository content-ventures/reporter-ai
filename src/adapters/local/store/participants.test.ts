import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { newProductionInput } from '../../../ports/contracts/fixture.ts';
import { createTestPorts } from './testing.ts';

/** A07: "Participantes" (name, role, organisation) and "Sem atribuição" survive as data. */

describe('participants of a production', () => {
  it('creates people with role and organisation, and records "Sem atribuição"', async () => {
    const ports = createTestPorts();
    const created = await ports.commands.createFromSource(
      newProductionInput({
        speakers: [
          { label: 'Repórter', unattributed: true },
          { label: 'Helena Duarte', newPerson: { name: 'Helena Duarte', title: 'presidente', organization: 'Cooperativa Vale Verde' } },
        ],
      }),
    );
    assert.ok(created.ok);
    const detail = await ports.queries.get(created.value.productionId);
    assert.ok(detail.ok);
    const helena = detail.value.participants.find((participant) => participant.label === 'Helena Duarte');
    const reporter = detail.value.participants.find((participant) => participant.label === 'Repórter');
    assert.equal(helena?.person?.organization, 'Cooperativa Vale Verde');
    assert.equal(helena?.person?.line, 'presidente da Cooperativa Vale Verde');
    assert.equal(reporter?.person, undefined);
    assert.equal(reporter?.unattributed, true, '"Sem atribuição" is a decision, not a missing person');
  });

  it('edits role and organisation of a person (Material drawer) and keeps the name required', async () => {
    const ports = createTestPorts();
    const created = await ports.commands.createFromSource(newProductionInput({ speakers: [{ label: 'Helena Duarte', newPerson: { name: 'Helena Duarte' } }] }));
    assert.ok(created.ok);
    const before = await ports.queries.get(created.value.productionId);
    assert.ok(before.ok);
    const personId = before.value.participants.find((participant) => participant.person)?.person?.id ?? '';
    const updated = await ports.commands.updatePerson(personId, { title: 'diretora da torrefação', organization: 'Vale Verde' });
    assert.ok(updated.ok);
    assert.equal(updated.value.line, 'diretora da torrefação da Vale Verde');
    const cleared = await ports.commands.updatePerson(personId, { organization: null });
    assert.ok(cleared.ok);
    assert.equal(cleared.value.organization, undefined);
    assert.equal(cleared.value.line, 'diretora da torrefação');
    const empty = await ports.commands.updatePerson(personId, { name: '  ' });
    assert.equal(!empty.ok && empty.refusal.code, 'empty_name');
    const unknown = await ports.commands.updatePerson('person-nobody', { title: 'x' });
    assert.equal(!unknown.ok && unknown.refusal.code, 'not_found');
  });

  it('marks and unmarks "Sem atribuição" from the Material drawer', async () => {
    const ports = createTestPorts();
    const created = await ports.commands.createFromSource(newProductionInput());
    assert.ok(created.ok);
    const marked = await ports.commands.updateSpeakers(created.value.sourceId, [{ label: 'Repórter', personId: null, unattributed: true }]);
    assert.ok(marked.ok);
    assert.equal(marked.value.speakers.find((participant) => participant.label === 'Repórter')?.unattributed, true);
    const undecided = await ports.commands.updateSpeakers(created.value.sourceId, [{ label: 'Repórter', personId: null }]);
    assert.ok(undecided.ok);
    assert.equal(undecided.value.speakers.find((participant) => participant.label === 'Repórter')?.unattributed, undefined);
  });
});
