import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ChangeNotice } from '../common.ts';
import { withPorts } from './fixture.ts';
import type { PortsFactory } from './fixture.ts';

/** SessionPort contract (REQ-T.1 plug): who acts, with which roles. */
export function sessionPortContract(name: string, make: PortsFactory): void {
  describe(`${name} · session contract`, () => {
    it('exposes the acting member and the workspace members with roles', () =>
      withPorts(make, async (ports) => {
        const current = await ports.session.current();
        assert.equal(current?.id, ports.people.editor);
        assert.ok(current?.roles.includes('editor'));
        assert.ok(current && current.initials.length > 0);
        const members = await ports.session.members();
        const approver = members.find((member) => member.id === ports.people.approver);
        assert.ok(approver?.roles.includes('approver'));
        const workspace = await ports.session.workspace();
        assert.ok(members.every((member) => member.workspaceId === workspace.id));
      }));

    it('switches the acting member only in simulated mode', async (context) => {
      await withPorts(make, async (ports) => {
        const actAs = ports.session.actAs;
        if (ports.session.mode !== 'simulated' || !actAs) {
          assert.equal(actAs, undefined, 'remote sessions never expose actAs');
          context.skip('remote session');
          return;
        }
        const notices: ChangeNotice[] = [];
        const unsubscribe = ports.session.subscribe((notice) => notices.push(notice));
        const switched = await actAs.call(ports.session, ports.people.approver);
        assert.equal(switched.ok, true);
        assert.equal((await ports.session.current())?.id, ports.people.approver);
        assert.ok(notices.some((notice) => notice.scope === 'session'));
        const unknown = await actAs.call(ports.session, 'nobody');
        assert.equal(unknown.ok, false);
        if (!unknown.ok) assert.equal(unknown.refusal.code, 'unknown_member');
        assert.equal((await ports.session.current())?.id, ports.people.approver);
        unsubscribe();
      });
    });
  });
}
