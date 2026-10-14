import assert from 'node:assert/strict';
import { test } from 'node:test';
import { storageRootPath } from '../src/server/storage.ts';

test('Vercel functions always use writable ephemeral storage', () => {
  assert.equal(storageRootPath({ VERCEL: '1' }, '/var/task'), '/tmp/reporter-ai');
});

test('Neon functions keep using writable ephemeral storage', () => {
  assert.equal(storageRootPath({ REPORTER_FUNCTION_RUNTIME: 'true' }, '/workspace'), '/tmp/reporter-ai');
});

test('local development keeps project-scoped storage', () => {
  assert.equal(storageRootPath({}, '/workspace/reporter-ai'), '/workspace/reporter-ai/.reporter-local');
});
