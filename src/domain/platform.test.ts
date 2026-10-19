import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { INVITE_LIMITS, INVITE_TOKEN, invitePath, validateInvite, validateNewPassword, validateRoles } from './platform.ts';
import { audioCostUsd, buildUsageReport, tokenCostUsd, usageWindow, type UsageFacts } from './platform-usage.ts';

const code = (result: { ok: boolean; refusal?: { code: string } }) => (result.ok ? undefined : result.refusal?.code);

describe('platform invite', () => {
  it('trims the name, lower-cases the e-mail and keeps one known role', () => {
    assert.deepEqual(validateInvite({ name: '  Ana   Souza ', email: ' Ana@Francal.COM ', role: 'editor', workspaceId: ' w1 ' }), {
      ok: true,
      value: { name: 'Ana Souza', email: 'ana@francal.com', role: 'editor', workspaceId: 'w1' },
    });
  });

  it('refuses a short name, a bad e-mail, an unknown role and no workspace', () => {
    assert.equal(code(validateInvite({ name: 'A', email: 'a@b.co', role: 'editor', workspaceId: 'w' })), 'invalid_name');
    assert.equal(code(validateInvite({ name: 'a'.repeat(INVITE_LIMITS.name + 1), email: 'a@b.co', role: 'editor', workspaceId: 'w' })), 'invalid_name');
    assert.equal(code(validateInvite({ name: 'Ana', email: 'ana@', role: 'editor', workspaceId: 'w' })), 'invalid_email');
    assert.equal(code(validateInvite({ name: 'Ana', email: 'ana @x.com', role: 'editor', workspaceId: 'w' })), 'invalid_email');
    assert.equal(code(validateInvite({ name: 'Ana', email: 'ana@x.com', role: 'owner' as never, workspaceId: 'w' })), 'invalid_role');
    assert.equal(code(validateInvite({ name: 'Ana', email: 'ana@x.com', role: 'admin', workspaceId: ' ' })), 'invalid_workspace');
  });

  it('builds the link from a base64url token only', () => {
    const token = 'a'.repeat(40) + '-_9';
    assert.match(token, INVITE_TOKEN);
    assert.equal(invitePath(token), `/auth/invite/${token}`);
    assert.doesNotMatch('../../etc', INVITE_TOKEN);
    assert.doesNotMatch('a'.repeat(44), INVITE_TOKEN);
  });

  it('asks for a password of 8 to 128 characters typed twice', () => {
    assert.equal(code(validateNewPassword('1234567', '1234567')), 'password_short');
    assert.equal(code(validateNewPassword('a'.repeat(129), 'a'.repeat(129))), 'password_long');
    assert.equal(code(validateNewPassword('12345678', '12345679')), 'password_mismatch');
    assert.deepEqual(validateNewPassword('12345678', '12345678'), { ok: true, value: '12345678' });
  });

  it('keeps roles in canonical order and refuses none', () => {
    assert.deepEqual(validateRoles(['admin', 'editor', 'admin']), { ok: true, value: ['editor', 'admin'] });
    assert.equal(code(validateRoles([])), 'no_roles');
  });
});

describe('platform usage', () => {
  it('prices tokens and audio by model, with or without the provider prefix', () => {
    assert.equal(tokenCostUsd('openai/gpt-oss-120b', 1_000_000, 1_000_000), 0.75);
    assert.equal(tokenCostUsd('gpt-oss-120b', 2_000_000, 0), 0.3);
    assert.equal(tokenCostUsd('anthropic/claude-sonnet-4-6', 1_000_000, 0), 3);
    assert.equal(tokenCostUsd('unknown-model', 10, 10), null);
    assert.equal(audioCostUsd('whisper-large-v3', 3600), 0.111);
    assert.equal(audioCostUsd('whisper-x', 3600), null);
  });

  it('places the period and the one before it on UTC days', () => {
    assert.deepEqual(usageWindow(7, '2026-10-19T23:30:00.000Z'), { from: '2026-10-13', to: '2026-10-19', previousFrom: '2026-10-06', previousTo: '2026-10-12' });
  });

  it('builds totals, deltas, a zero-filled series and rankings', () => {
    const facts: UsageFacts = {
      generations: [
        { day: '2026-10-19', personId: 'ana', workspaceId: 'w', model: 'openai/gpt-oss-120b', completed: 3, failed: 1, inputTokens: 1_000_000, outputTokens: 1_000_000 },
        { day: '2026-10-18', personId: 'rui', workspaceId: 'w', model: 'mystery', completed: 1, failed: 0, inputTokens: 100, outputTokens: 100 },
        { day: '2026-10-10', personId: 'ana', workspaceId: 'w', model: 'openai/gpt-oss-120b', completed: 9, failed: 0, inputTokens: 5, outputTokens: 5 },
      ],
      productions: [{ day: '2026-10-19', personId: 'ana', workspaceId: 'w', count: 2 }],
      approvals: [{ day: '2026-10-19', personId: 'rui', workspaceId: 'w', count: 1 }],
      audio: [{ day: '2026-10-17', personId: 'ana', workspaceId: 'w', model: 'whisper-large-v3', seconds: 3600 }],
      activeDays: [
        { day: '2026-10-19', personId: 'ana', workspaceId: 'w' },
        { day: '2026-10-18', personId: 'ana', workspaceId: 'w' },
        { day: '2026-10-19', personId: 'rui', workspaceId: 'w' },
        { day: '2026-10-11', personId: 'leo', workspaceId: 'w' },
      ],
      storageBytes: 2048,
    };
    const report = buildUsageReport(facts, 7, '2026-10-19T12:00:00.000Z');
    assert.equal(report.days.length, 7);
    assert.equal(report.days[0].day, '2026-10-13');
    assert.equal(report.days.at(-1)?.generations, 3);
    assert.equal(report.days.at(-1)?.activePeople, 2);
    assert.equal(report.totals.generations, 4);
    assert.equal(report.totals.failedGenerations, 1);
    assert.equal(report.totals.productions, 2);
    assert.equal(report.totals.approvals, 1);
    assert.equal(report.totals.activePeople, 2);
    assert.equal(report.totals.audioMinutes, 60);
    assert.ok(Math.abs(report.totals.costUsd - (0.75 + 0.111)) < 1e-9);
    assert.equal(report.totals.unpriced, true);
    assert.equal(report.previous.generations, 9);
    assert.equal(report.previous.activePeople, 1);
    assert.deepEqual(report.models.map((model) => model.model), ['openai/gpt-oss-120b', 'mystery']);
    assert.equal(report.models[1].costUsd, null);
    assert.deepEqual(report.people.map((person) => [person.personId, person.generations, person.activeDays]), [['ana', 3, 2], ['rui', 1, 1]]);
    assert.equal(report.workspaces[0].activePeople, 2);
    assert.equal(report.storageBytes, 2048);
  });
});
