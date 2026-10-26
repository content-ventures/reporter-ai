import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assignedTemplateIds,templateConfigurationHash,validateTemplateConfiguration,workspaceTemplateHash,workspaceTemplateId} from './workspace-templates.ts';
import type {WorkspaceTemplateInput,WorkspaceTemplateRevision} from './workspace-templates.ts';
const workspaceId='20000000-0000-0000-0000-000000000101';
const config:WorkspaceTemplateInput={publication:'Naturaltech',presets:['photo','editorial'],defaultPreset:'editorial',font:'Inter'};
test('template setup validates approved presets, default, fonts and owned-logo identifier shape',()=>{
  const checked=validateTemplateConfiguration(config);assert.equal(checked.ok,true);if(!checked.ok)return;
  assert.deepEqual(checked.value.presets,['editorial','photo']);assert.deepEqual(config.presets,['photo','editorial']);
  for(const invalid of [{...config,presets:[]},{...config,publication:''},{...config,presets:['photo']},{...config,presets:['editorial','editorial']},
    {...config,logoId:'../../other-workspace'},{...config,font:'Unregistered font'},{...config,presets:['seafood']}])
    assert.equal(validateTemplateConfiguration(invalid as WorkspaceTemplateInput).ok,false);
});
test('each template ID captures its client and immutable configuration, including brand and typeface',()=>{
  const hash=templateConfigurationHash(workspaceId,config),revision={workspaceId,hash,config} as WorkspaceTemplateRevision;
  assert.notEqual(hash,templateConfigurationHash('30000000-0000-0000-0000-000000000101',config));
  assert.notEqual(hash,templateConfigurationHash(workspaceId,{...config,font:'Montserrat'}));
  assert.equal(workspaceTemplateHash(workspaceTemplateId(revision,'editorial'),workspaceId),hash);
  assert.equal(workspaceTemplateHash(workspaceTemplateId(revision,'editorial'),'another-client'),undefined);
  assert.equal(assignedTemplateIds(revision).length,2);assert.deepEqual(assignedTemplateIds(null),[]);
});
