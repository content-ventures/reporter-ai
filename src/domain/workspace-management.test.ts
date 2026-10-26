import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateWorkspace, workspaceReadiness } from './workspace-management.ts';

test('client names retain their identity; ambiguous or reserved addresses are refused', () => {
  assert.deepEqual(validateWorkspace({ name: '  Seafood   Brasil  ', slug: 'seafood-brasil' }),
    { ok: true, value: { name: 'Seafood Brasil', slug: 'seafood-brasil' } });
  for (const slug of ['Seafood', 'seafood--brasil', '../seafood', 'api', 'seafood/', '-seafood', 'seafood-', 'a'.repeat(64)]) {
    const result = validateWorkspace({ name: 'Client', slug });
    assert.equal(result.ok, false, slug);
    if (!result.ok) assert.equal(result.refusal.code, 'invalid_slug');
  }
});

test('an empty client identifies its missing configuration instead of inheriting the pilot', () => {
  const configured = { editorial_map: false, writing_guide: false, templates: false, editor: false, approver: false };
  assert.deepEqual(workspaceReadiness(configured).missing, ['editorial_map', 'writing_guide', 'templates', 'editor', 'approver']);
  assert.deepEqual(workspaceReadiness({ ...configured, editorial_map: true, editor: true }).missing,
    ['writing_guide', 'templates', 'approver']);
  assert.deepEqual(workspaceReadiness({ editorial_map: true, writing_guide: true, templates: true, editor: true, approver: true }),
    { ready: true, missing: [] });
});
