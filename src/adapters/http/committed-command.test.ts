import assert from 'node:assert/strict';
import { test } from 'node:test';
import { committedCommand } from './committed-command.ts';
test('an accepted creation stays successful when the read projection fails; no duplicate write', async () => {
  let writes = 0;
  const result = await committedCommand(async () => { writes++;return { ok: true,id: 'saved' }; },async () => { throw new Error('read timeout'); });
  assert.equal(writes,1);assert.deepEqual(result,{ ok: true,id: 'saved' });
});
test('a real write failure remains a failure and never reads a misleading projection', async () => {
  let reads = 0;
  await assert.rejects(committedCommand(async () => { throw new Error('write failed'); },async () => { reads++; }),/write failed/);
  assert.equal(reads,0);
});
