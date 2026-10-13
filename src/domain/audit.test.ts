import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AUDIT_ACTION_IDS, AUDIT_ACTIONS, AUDIT_TYPES, auditTitle, canReadAudit, compareAuditDesc, maskIp } from './audit.ts';

describe('audit domain', () => {
  it('every action has a pt-BR line per result and belongs to a filterable type', () => {
    for (const action of AUDIT_ACTION_IDS) {
      assert.ok(AUDIT_TYPES.includes(AUDIT_ACTIONS[action].type), action);
      for (const result of ['success', 'denied', 'failure'] as const) assert.ok(auditTitle(action, result).length > 0);
    }
    assert.equal(auditTitle('auth.signed_in', 'success'), 'Login realizado');
    assert.equal(auditTitle('access.denied', 'denied'), 'Acesso negado');
    assert.equal(auditTitle('article.updated', 'failure'), 'Falha ao salvar o artigo');
    assert.equal(auditTitle('auth.signed_out', 'failure'), 'Sessão encerrada · Falha', 'no dedicated line: success line + result');
  });

  it('auth.*, access.denied and *.updated exist (F1.7 trail)', () => {
    for (const action of ['auth.signed_in', 'auth.signed_out', 'access.denied', 'production.updated', 'source.updated', 'article.updated', 'carousel.updated', 'member.updated'] as const) {
      assert.ok(AUDIT_ACTION_IDS.includes(action), action);
    }
  });

  it('only admins read the trail', () => {
    assert.equal(canReadAudit(['editor', 'admin']), true);
    assert.equal(canReadAudit(['approver']), false);
    assert.equal(canReadAudit(undefined), false);
  });

  it('masks IPs and orders newest first', () => {
    assert.equal(maskIp('189.6.44.120'), '189.6.•••.•••');
    assert.equal(maskIp('2804:14c:5b:1::1'), '2804:14c:•••');
    const events = [
      { id: 'a', at: '2026-10-07T10:00:00.000Z' },
      { id: 'c', at: '2026-10-07T12:00:00.000Z' },
      { id: 'b', at: '2026-10-07T12:00:00.000Z' },
    ];
    assert.deepEqual(events.sort(compareAuditDesc).map((event) => event.id), ['c', 'b', 'a']);
  });
});
