import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { can, CAPABILITY_ROLES, forbidden, roleLabel, whoCan } from './permissions.ts';
import type { Capability } from './permissions.ts';
import type { Role } from './workspace.ts';

const MATRIX: Record<Capability, Role[]> = {
  'production.create': ['editor', 'admin'],
  'production.edit': ['editor', 'admin'],
  'production.archive': ['editor', 'admin'],
  'piece.edit': ['editor', 'admin'],
  'piece.send': ['editor', 'admin'],
  'delivery.record': ['editor', 'admin'],
  'feedback.record': ['editor', 'admin'],
  'pipeline.edit': ['admin'],
  'audit.read': ['admin'],
  'library.edit': ['editor', 'admin'],
  'library.review': ['editor', 'approver', 'creative_reviewer', 'admin'],
  'profile.edit_self': ['editor', 'approver', 'creative_reviewer', 'admin'],
};

describe('permissions', () => {
  it('every role × capability follows the matrix', () => {
    assert.deepEqual(Object.keys(CAPABILITY_ROLES).sort(), Object.keys(MATRIX).sort());
    for (const [capability, allowed] of Object.entries(MATRIX) as [Capability, Role[]][]) {
      for (const role of ['editor', 'approver', 'creative_reviewer', 'admin'] as const) {
        assert.equal(can({ roles: [role] }, capability), allowed.includes(role), `${role} ${capability}`);
      }
    }
  });

  it('fails closed and accepts a role list', () => {
    assert.equal(can(undefined, 'piece.edit'), false);
    assert.equal(can({ roles: [] }, 'piece.edit'), false);
    assert.equal(can(['approver', 'creative_reviewer'], 'production.create'), false);
    assert.equal(can(['approver', 'editor'], 'production.create'), true);
  });

  it('keeps read-only member roles visible without granting edit, approval, profile or export authority',()=>{
    const member={roles:['admin'] as Role[],readOnly:true as const};
    for(const capability of Object.keys(MATRIX) as Capability[])assert.equal(can(member,capability),capability==='audit.read',capability);
    assert.deepEqual(member.roles,['admin']);
    assert.equal(can({roles:['editor'],readOnly:true},'audit.read'),false);
  });

  it('names who can in one sentence', () => {
    assert.equal(whoCan('production.create'), 'Só editor ou admin cria produções.');
    assert.equal(whoCan('pipeline.edit'), 'Só admin edita os prompts.');
    assert.deepEqual(forbidden('piece.edit'), { ok: false, refusal: { code: 'forbidden', message: 'Só editor ou admin edita o conteúdo.', details: { capability: 'piece.edit' } } });
    assert.equal(roleLabel('creative_reviewer'), 'Revisor criativo');
  });
});
