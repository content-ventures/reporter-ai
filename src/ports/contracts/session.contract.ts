import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ChangeNotice } from '../common.ts';
import { pngFile } from './assets.contract.ts';
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

    it('edits only the acting member\'s own name and cargo', () =>
      withPorts(make, async (ports) => {
        const before = (await ports.session.current())!;
        const approverBefore = (await ports.session.members()).find((member) => member.id === ports.people.approver);
        try {
          const renamed = await ports.session.updateProfile({ name: '  Ana   Perfil ', title: ' Editora-chefe ' });
          assert.equal(renamed.ok, true);
          if (renamed.ok) assert.equal(renamed.value.name, 'Ana Perfil');
          const current = await ports.session.current();
          assert.equal(current?.id, before.id);
          assert.equal(current?.name, 'Ana Perfil');
          assert.equal(current?.title, 'Editora-chefe');
          assert.deepEqual(current?.roles, before.roles, 'roles are never self-edited');
          const members = await ports.session.members();
          assert.equal(members.find((member) => member.id === before.id)?.name, 'Ana Perfil');
          assert.deepEqual(members.find((member) => member.id === ports.people.approver), approverBefore, 'nobody else changes');

          assert.equal((await ports.session.updateProfile({ title: null })).ok, true);
          assert.equal((await ports.session.current())?.title, undefined);

          for (const [patch, code] of [[{ name: '   ' }, 'empty_name'], [{ name: 'a'.repeat(81) }, 'too_long'], [{ title: 'a'.repeat(81) }, 'too_long']] as const) {
            const refused = await ports.session.updateProfile(patch);
            assert.equal(refused.ok ? undefined : refused.refusal.code, code);
          }
          assert.equal((await ports.session.current())?.name, 'Ana Perfil', 'a refusal keeps the profile');
        } finally {
          // Remote people outlive a contract's workspace: leave the profile as it was.
          await ports.session.updateProfile({ name: before.name, title: before.title ?? null });
        }
      }));

    it('sets and removes the acting member\'s photo', async (context) => {
      await withPorts(make, async (ports) => {
        if (ports.storesAvatars !== false) {
          const notices: ChangeNotice[] = [];
          const unsubscribe = ports.session.subscribe((notice) => notices.push(notice));
          const set = await ports.session.setAvatar({ file: pngFile(640, 480), fileName: 'retrato.png' });
          assert.equal(set.ok, true);
          const photo = (await ports.session.current())?.avatarUrl;
          assert.ok(photo, 'the photo is stored');
          assert.ok(notices.some((notice) => notice.scope === 'session'));
          unsubscribe();
        }
        const text = await ports.session.setAvatar({ file: new Blob(['não é imagem'], { type: 'image/png' }), fileName: 'falso.png' });
        assert.equal(text.ok ? undefined : text.refusal.code, 'invalid_image');
        const removed = await ports.session.setAvatar(null);
        assert.equal(removed.ok, true);
        assert.equal((await ports.session.current())?.avatarUrl, undefined);
        if (ports.storesAvatars === false) context.skip('photo storage is covered by the server tests');
      });
    });
  });
}
