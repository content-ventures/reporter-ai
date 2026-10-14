import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localDevelopmentEnvironment, nextDevArguments } from './dev-local.mjs';

test('local app always uses the isolated local backend despite cloud settings in .env.local', () => {
  const environment = localDevelopmentEnvironment({
    REPORTER_DEPLOYMENT_MODE: 'cloud',
    REPORTER_LOCAL_MODE: 'false',
    GROQ_API_KEY: 'kept-in-process-only',
  });

  assert.equal(environment.REPORTER_DEPLOYMENT_MODE, 'local');
  assert.equal(environment.REPORTER_LOCAL_MODE, 'true');
  assert.equal(environment.GROQ_API_KEY, 'kept-in-process-only');
});

test('local app binds Next only to loopback on its documented port', () => {
  assert.deepEqual(nextDevArguments(), [
    process.cwd() + '/node_modules/next/dist/bin/next',
    'dev',
    '--hostname',
    '127.0.0.1',
    '--port',
    '3002',
  ]);
});
