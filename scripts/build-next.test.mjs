import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildEnvironment } from './build-next.mjs';

test('one build gets one public deployment id without changing the caller environment', () => {
  const env = { NODE_ENV: 'production', EXAMPLE_SERVER_SECRET: 'synthetic-secret' };
  const result = buildEnvironment(env, () => 'synthetic-id');
  assert.equal(result.NEXT_DEPLOYMENT_ID, 'reporter-synthetic-id');
  assert.equal(result.EXAMPLE_SERVER_SECRET, env.EXAMPLE_SERVER_SECRET);
  assert.equal(env.NEXT_DEPLOYMENT_ID, undefined);
  assert.notEqual(buildEnvironment({}).NEXT_DEPLOYMENT_ID, buildEnvironment({}).NEXT_DEPLOYMENT_ID);
});

test('an explicitly configured release deployment id wins and is not regenerated', () => {
  const result = buildEnvironment({ NEXT_DEPLOYMENT_ID: 'release-one' }, () => { throw new Error('must not generate'); });
  assert.equal(result.NEXT_DEPLOYMENT_ID, 'release-one');
});
