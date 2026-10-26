import assert from 'node:assert/strict';
import {test} from 'node:test';
import {emptyEditorialCheckpoint} from '../src/runtime/editorial-engine.ts';
import {defaultPipelineDefinition,pipelineRevision} from '../src/domain/pipeline.ts';
import {activePipeline,parsePipelineDefinition} from '../src/server/pipeline.ts';

test('only preserved pilot identities receive implicit legacy defaults, independently of a client name or slug',()=>{
  const checkpoint=emptyEditorialCheckpoint();
  const original=pipelineRevision(defaultPipelineDefinition());checkpoint.pipeline=structuredClone(original);
  for(const id of ['10000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000101']){
    checkpoint.state.workspace={...checkpoint.state.workspace,id};
    assert.equal(activePipeline(checkpoint).hash,original.hash);
    assert.equal(activePipeline(checkpoint).definition.funnelPreset,undefined);
  }
  checkpoint.state.workspace={...checkpoint.state.workspace,id:'20000000-0000-0000-0000-000000000101',slug:'reporter-ai',name:'Seafood Brasil'};
  const neutral=activePipeline(checkpoint);
  assert.equal(neutral.definition.funnelPreset,'neutral-v1');assert.notEqual(neutral.hash,original.hash);
  assert.deepEqual(checkpoint.pipeline,original,'resolving a new default never rewrites stored history');
  checkpoint.pipeline=undefined;
  assert.equal(activePipeline(checkpoint).definition.funnelPreset,'neutral-v1');
});

test('pipeline input accepts the versioned neutral preset and refuses an arbitrary client-supplied legacy selector',()=>{
  const definition={...defaultPipelineDefinition(),funnelPreset:'neutral-v1' as const};
  assert.ok(parsePipelineDefinition(definition).definition);
  assert.equal(parsePipelineDefinition({...definition,funnelPreset:'seafood'}).definition,undefined);
});
