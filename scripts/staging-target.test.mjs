import assert from 'node:assert/strict';
import test from 'node:test';

test('acceptance runs only on an explicitly staging, unprotected branch', async () => {
  const { assertStagingTarget, acceptanceOrigin } = await import('./lib/staging-target.mjs');
  const staging = { REPORTER_ACCEPTANCE_TARGET: 'staging', NEON_API_KEY: 'key', NEON_PROJECT_ID: 'stage', NEON_BRANCH_ID: 'br-stage' };
  const answer = branch => async () => Response.json({ branch });
  assert.equal((await assertStagingTarget(staging, answer({ id: 'br-stage', protected: false }))).id, 'br-stage');
  await assert.rejects(assertStagingTarget(staging, answer({ id: 'br-main', protected: true })), /refuses a protected branch/);
  await assert.rejects(assertStagingTarget({ ...staging, REPORTER_ACCEPTANCE_TARGET: undefined }, answer({ protected: false })), /only to staging/);
  await assert.rejects(assertStagingTarget({ ...staging, NEON_BRANCH_ID: '' }, answer({ protected: false })), /Missing NEON_BRANCH_ID/);
  assert.equal(acceptanceOrigin({ REPORTER_APP_ORIGINS: ' https://staging.example.test , https://other.example.test' }), 'https://staging.example.test');
  assert.throws(() => acceptanceOrigin({}), /must list the staging app origin/);
});
