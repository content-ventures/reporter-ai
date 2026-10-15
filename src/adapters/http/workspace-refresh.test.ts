import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkspaceRefresh } from './workspace-refresh.ts';

test('a committed write waits for a new read after any older poll, sharing concurrent refreshes', async () => {
  const releases: (() => void)[] = [];
  let requests = 0, completed = false;
  const refresh = createWorkspaceRefresh(() => { requests++; return new Promise<void>(resolve => releases.push(resolve)); });
  const oldPoll = refresh();
  assert.equal(refresh(), oldPoll);
  const afterWrite = refresh(true).then(() => { completed = true; });
  const anotherWriteRefresh = refresh(true);
  assert.equal(requests, 1);
  releases[0]();
  await oldPoll;
  await new Promise<void>(resolve => queueMicrotask(resolve));
  assert.equal(requests, 2, 'the new read starts only after the earlier one settles');
  assert.equal(completed, false, 'the write cannot acknowledge an older projection');
  releases[1]();
  await Promise.all([afterWrite, anotherWriteRefresh]);
  assert.equal(requests, 2);
  assert.equal(completed, true);
});

test('a failed older poll does not prevent refreshing a committed write', async () => {
  let requests = 0, rejectOld!: (error: Error) => void;
  const refresh = createWorkspaceRefresh(() => ++requests === 1
    ? new Promise<void>((_resolve, reject) => { rejectOld = reject; }) : Promise.resolve());
  const oldPoll = refresh();
  const failed = assert.rejects(oldPoll, /Earlier read failed/);
  const afterWrite = refresh(true);
  rejectOld(new Error('Earlier read failed'));
  await Promise.all([failed, afterWrite]);
  assert.equal(requests, 2);
});
