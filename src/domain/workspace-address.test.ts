import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workspaceAddress, workspaceApiPath,workspacePagePath,workspaceHref } from './workspace-address.ts';

test('two addressable contexts keep different API destinations, including identical entity IDs', () => {
  const a = workspaceAddress('/w/seafood-brasil/productions/same-id')!;
  const b = workspaceAddress('/w/another-client/productions/same-id')!;
  assert.equal(a.path, b.path);
  assert.notEqual(workspaceApiPath(a.slug,'/workspace'),workspaceApiPath(b.slug,'/workspace'));
  assert.equal(workspaceApiPath(undefined,'/workspace'),'/api/reporter/workspace');
  assert.equal(workspacePagePath(a.slug,'/library/templates?model=own'),'/w/seafood-brasil/library/templates?model=own');
  assert.equal(workspacePagePath(undefined,'/library/templates'),'/library/templates');
});
test('product links retain the client, while global and external destinations keep their addresses',()=>{
  for(const path of ['/','/account','/news?query=fish','/productions/id/article#paragraph'])assert.equal(workspaceHref('client',path),`/w/client${path}`);
  for(const path of ['/platform/workspaces','/workspaces?entry=1','/auth/sign-in','/api/reporter/avatars/id','/w/another/','https://source.test/report','//source.test/report','#paragraph'])assert.equal(workspaceHref('client',path),path);
});
test('an invalid context is refused instead of becoming the legacy destination', () => {
  for (const slug of ['../pilot', 'a/b', 'Seafood', 'a%2fb', 'client?other', '']) assert.throws(() => workspaceApiPath(slug,'/workspace'));
  assert.throws(() => workspaceApiPath('client','//outside.invalid'));
});
