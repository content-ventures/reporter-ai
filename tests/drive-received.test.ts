import assert from 'node:assert/strict';
import { test } from 'node:test';
import { driveReceived } from '../src/server/drive-intake.ts';

test('outside the cloud the board lists no Drive files and opens none, without touching the database', async () => {
  process.env.REPORTER_DEPLOYMENT_MODE = 'local';
  const list = await driveReceived([]);
  assert.equal(list.status, 200);
  assert.deepEqual(await list.json(), { items: [] });
  await assert.rejects(driveReceived(['00000000-0000-4000-8000-000000000001']), (error: { code?: string }) => error.code === 'NOT_FOUND');
});
