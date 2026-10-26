import assert from 'node:assert/strict';
import {test} from 'node:test';
import {proposeConfigurationCopy,type ConfigurationSnapshot} from './configuration-copy.ts';
import {defaultPipelineDefinition,pipelineRevision} from './pipeline.ts';
import {defaultEditorialPolicy} from './editorial-policy.ts';

const snapshot=(id:string):ConfigurationSnapshot=>({workspace:{id,name:id,slug:id,status:'draft',revision:1,pilot:false,createdAt:'2026-10-26T00:00:00Z',updatedAt:'2026-10-26T00:00:00Z',readiness:{ready:false,missing:[]}},
  pipeline:pipelineRevision({...defaultPipelineDefinition(),editorial:defaultEditorialPolicy()}),templates:{workspaceId:id,revision:1,pilot:false,readiness:{ready:false,missing:[]},active:null,history:[]}});
test('prompt copying does not copy the editorial policy or invent a target brand',()=>{
  const source=snapshot('source'),target=snapshot('target');
  source.pipeline!.definition.systemPrompt='Source custom instructions';source.pipeline!.definition.editorial!.map.audience='Source audience';
  target.pipeline!.definition.editorial!.map.audience='Target audience';
  const copied=proposeConfigurationCopy(source,target,['prompts'],defaultPipelineDefinition());
  assert.equal(copied.definition.systemPrompt,'Source custom instructions');assert.equal(copied.definition.editorial!.map.audience,'Target audience');
  assert.equal(copied.definition.funnelPreset,'neutral-v1');assert.equal(copied.templates,undefined);assert.deepEqual(copied.changes.map(change=>change.field),['prompts']);
  assert.throws(()=>proposeConfigurationCopy(source,target,['templates'],defaultPipelineDefinition()),/COPY_TEMPLATES_UNAVAILABLE/);
});
