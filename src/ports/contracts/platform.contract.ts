import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { INVITE_TOKEN } from '../../domain/platform.ts';
import type { InviteDesk, PlatformConsole } from '../platform.ts';

/**
 * Platform console contract: what the console screens and the invite page rely on. The demo
 * adapter passes it; the connected adapter answers the same shapes and refusal codes from the
 * database functions of migration 020.
 */

export type PlatformUnderTest = {
  console: PlatformConsole;
  invites: InviteDesk;
  /** Moves the clock forward (expiry of a link). */
  advance(ms: number): void;
};

export type PlatformFactory = () => PlatformUnderTest | Promise<PlatformUnderTest>;

const DAY_MS = 86_400_000;

function value<T>(result: { ok: true; value: T } | { ok: false; refusal: { code: string; message: string } }): T {
  if (!result.ok) assert.fail(`refused: ${result.refusal.code} (${result.refusal.message})`);
  return result.value;
}

function code(result: { ok: boolean; refusal?: { code: string } }): string | undefined {
  return result.ok ? undefined : result.refusal?.code;
}

export function platformContract(make: PlatformFactory): void {
  describe('platform console contract', () => {
    it('opens for the operator, with people and workspaces', async () => {
      const { console: platform } = await make();
      const operator = value(await platform.operator());
      const directory = value(await platform.directory());
      assert.ok(directory.workspaces.length >= 1);
      assert.ok(directory.people.some((person) => person.id === operator.id && person.operator));
    });

    it('creates access by link, once per e-mail', async () => {
      const { console: platform } = await make();
      const { workspaces } = value(await platform.directory());
      let notices = 0;
      const off = platform.subscribe(() => { notices += 1; });
      const issued = value(await platform.invite({ name: ' Lia  Moraes ', email: 'Lia@Exemplo.com', role: 'editor', workspaceId: workspaces[0].id }));
      off();
      assert.match(issued.token, INVITE_TOKEN);
      assert.equal(issued.person.status, 'invited');
      assert.equal(issued.person.email, 'lia@exemplo.com');
      assert.equal(issued.person.name, 'Lia Moraes');
      assert.deepEqual(issued.person.roles, ['editor']);
      assert.ok(notices >= 1);
      assert.equal(code(await platform.invite({ name: 'Lia', email: 'lia@exemplo.com', role: 'editor', workspaceId: workspaces[0].id })), 'email_taken');
      assert.equal(code(await platform.invite({ name: 'Lia', email: 'lia', role: 'editor', workspaceId: workspaces[0].id })), 'invalid_email');
      const log = value(await platform.log(10));
      assert.equal(log.items[0].action, 'invite.created');
      assert.equal(log.items[0].target?.email, 'lia@exemplo.com');
    });

    it('lets the person define the password once, before the link expires', async () => {
      const { console: platform, invites, advance } = await make();
      const { workspaces } = value(await platform.directory());
      const issued = value(await platform.invite({ name: 'Caio Nogueira', email: 'caio@exemplo.com', role: 'approver', workspaceId: workspaces[0].id }));
      const preview = value(await invites.preview(issued.token));
      assert.equal(preview.state, 'open');
      assert.equal(preview.email, 'caio@exemplo.com');
      assert.deepEqual(preview.roles, ['approver']);
      assert.equal(code(await invites.accept(issued.token, '1234567', '1234567')), 'password_short');
      assert.equal(code(await invites.accept(issued.token, '12345678', '87654321')), 'password_mismatch');
      assert.equal(value(await invites.accept(issued.token, 'senha-segura', 'senha-segura')).email, 'caio@exemplo.com');
      assert.equal(value(await invites.preview(issued.token)).state, 'used');
      assert.equal(code(await invites.accept(issued.token, 'senha-segura', 'senha-segura')), 'used');
      const person = value(await platform.directory()).people.find((entry) => entry.email === 'caio@exemplo.com');
      assert.equal(person?.status, 'active');

      const late = value(await platform.invite({ name: 'Otávio Kern', email: 'otavio@exemplo.com', role: 'editor', workspaceId: workspaces[0].id }));
      advance(8 * DAY_MS);
      assert.equal(value(await invites.preview(late.token)).state, 'expired');
      assert.equal(code(await invites.accept(late.token, 'senha-segura', 'senha-segura')), 'expired');
      assert.equal(code(await invites.preview('x'.repeat(43))), 'invalid_link');
      assert.equal(code(await invites.preview('../nope')), 'invalid_link');
    });

    it('a new link replaces the previous one', async () => {
      const { console: platform, invites } = await make();
      const { workspaces } = value(await platform.directory());
      const first = value(await platform.invite({ name: 'Gustavo Hoff', email: 'gustavo@exemplo.com', role: 'editor', workspaceId: workspaces[0].id }));
      const second = value(await platform.renewInvite(first.person.id));
      assert.notEqual(second.token, first.token);
      assert.equal(value(await invites.preview(first.token)).state, 'revoked');
      assert.equal(value(await invites.preview(second.token)).state, 'open');
    });

    it('changes roles, suspends and restores, never the operator themself', async () => {
      const { console: platform, invites } = await make();
      const { workspaces } = value(await platform.directory());
      const operator = value(await platform.operator());
      const issued = value(await platform.invite({ name: 'Renata Vidal', email: 'renata@exemplo.com', role: 'editor', workspaceId: workspaces[0].id }));
      value(await invites.accept(issued.token, 'senha-segura', 'senha-segura'));
      const id = issued.person.id;
      assert.deepEqual(value(await platform.setRoles(id, ['admin', 'approver'])).roles, ['approver', 'admin']);
      assert.equal(code(await platform.setRoles(id, [])), 'no_roles');
      assert.equal(value(await platform.suspend(id)).status, 'suspended');
      assert.equal(code(await platform.suspend(id)), 'invalid_state');
      assert.equal(value(await platform.restore(id)).person.status, 'active');
      assert.equal(code(await platform.suspend(operator.id)), 'self');
      assert.equal(code(await platform.setRoles(operator.id, ['editor'])), 'self');
      assert.equal(code(await platform.suspend('nobody')), 'not_found');
    });

    it('suspending someone on an open link closes the link; restoring issues a new one', async () => {
      const { console: platform, invites } = await make();
      const { workspaces } = value(await platform.directory());
      const issued = value(await platform.invite({ name: 'Fernanda Kuhn', email: 'fernanda@exemplo.com', role: 'editor', workspaceId: workspaces[0].id }));
      value(await platform.suspend(issued.person.id));
      assert.equal(value(await invites.preview(issued.token)).state, 'revoked');
      const restored = value(await platform.restore(issued.person.id));
      assert.equal(restored.person.status, 'invited');
      assert.ok(restored.invite);
      assert.equal(value(await invites.preview(restored.invite.token)).state, 'open');
    });

    it('answers usage for each period with a full daily series', async () => {
      const { console: platform } = await make();
      for (const period of [7, 30, 90] as const) {
        const report = value(await platform.usage(period));
        assert.equal(report.period, period);
        assert.equal(report.days.length, period);
        assert.ok(report.totals.generations >= 0);
      }
    });
  });
}
