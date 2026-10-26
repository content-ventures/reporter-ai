import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workspaceAddress, workspaceApiPath } from './workspace-address.ts';

test('two addressable contexts keep different API destinations, including identical entity IDs', () => {
  const a = workspaceAddress('/w/seafood-brasil/productions/same-id')!;
  const b = workspaceAddress('/w/another-client/productions/same-id')!;
  assert.equal(a.path, b.path);
  assert.notEqual(workspaceApiPath(a.slug,'/workspace'),workspaceApiPath(b.slug,'/workspace'));
  assert.equal(workspaceApiPath(undefined,'/workspace'),'/api/reporter/workspace');
});
test('an invalid context is refused instead of becoming the legacy destination', () => {
  for (const slug of ['../pilot', 'a/b', 'Seafood', 'a%2fb', 'client?other', '']) assert.throws(() => workspaceApiPath(slug,'/workspace'));
  assert.throws(() => workspaceApiPath('client','//outside.invalid'));
});
