import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseWorkspacePreference,workspacePreferenceKey} from './workspace-preference.ts';
test('destination preferences cannot become URLs or cross-account storage slots',()=>{
  assert.notEqual(workspacePreferenceKey('account-one'),workspacePreferenceKey('account-two'));
  assert.deepEqual(parseWorkspacePreference('{"workspaceId":"id","slug":"client-name","roles":["admin"]}'),{workspaceId:'id',slug:'client-name'});
  for(const raw of [null,'{','null','{"workspaceId":"id","slug":"javascript:alert(1)"}','{"workspaceId":"id","slug":"../other"}'])assert.equal(parseWorkspacePreference(raw),undefined);
});
