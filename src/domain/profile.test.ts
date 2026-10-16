import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AVATAR_PATH, avatarPath, PROFILE_LIMITS, validateProfilePatch } from './profile.ts';

describe('profile patch', () => {
  it('trims the name, collapses spaces and clears a blank cargo', () => {
    assert.deepEqual(validateProfilePatch({ name: '  Ana   Souza ', title: '   ' }), { ok: true, value: { name: 'Ana Souza', title: null } });
    assert.deepEqual(validateProfilePatch({ title: ' Editora ' }), { ok: true, value: { title: 'Editora' } });
    assert.deepEqual(validateProfilePatch({ title: null }), { ok: true, value: { title: null } });
    assert.deepEqual(validateProfilePatch({}), { ok: true, value: {} });
  });

  it('refuses a blank name and over-long fields', () => {
    const blank = validateProfilePatch({ name: '   ' });
    assert.equal(blank.ok, false);
    if (!blank.ok) assert.equal(blank.refusal.code, 'empty_name');
    const longName = validateProfilePatch({ name: 'a'.repeat(PROFILE_LIMITS.name + 1) });
    assert.equal(longName.ok ? undefined : longName.refusal.code, 'too_long');
    const longTitle = validateProfilePatch({ title: 'a'.repeat(PROFILE_LIMITS.title + 1) });
    assert.equal(longTitle.ok ? undefined : longTitle.refusal.code, 'too_long');
    assert.equal(validateProfilePatch({ name: 'a'.repeat(PROFILE_LIMITS.name) }).ok, true);
  });

  it('names a photo by its content hash only', () => {
    const path = avatarPath('a'.repeat(64));
    assert.match(path, AVATAR_PATH);
    assert.doesNotMatch('/api/reporter/profile/avatar/../x.image', AVATAR_PATH);
    assert.doesNotMatch('https://example.com/a.png', AVATAR_PATH);
  });
});
