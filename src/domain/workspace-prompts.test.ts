import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {defaultFunnelPrompt,FUNNEL_STEP_KEYS,neutralFunnelPrompt} from './format-prompts.ts';
import {EDITORIAL_FORMATS} from './formats.ts';
import {compactFunnels,defaultPipelineDefinition,formatPipelineDefinition,pipelineRevision,withFormatFunnels} from './pipeline.ts';
import {KNOWN_DEFAULT_PROMPTS,promptHash,upgradePreset} from './pipeline-preset.ts';

test('adopting the pilot preserves every legacy format prompt byte for byte',()=>{
  const prompts=EDITORIAL_FORMATS.flatMap(format=>FUNNEL_STEP_KEYS.map(key=>[format,key,defaultFunnelPrompt(format,key)]));
  assert.equal(createHash('sha256').update(JSON.stringify(prompts)).digest('hex'),'f75c6f8a84907b675303d9eac0e49bcb34b09bac76e93fda717ebd41af55da38');
});
test('every neutral format uses the client policy and excludes the pilot identity, sector and fictional people',()=>{
  for(const format of EDITORIAL_FORMATS)for(const key of FUNNEL_STEP_KEYS){
    const prompt=neutralFunnelPrompt(format,key);
    assert.doesNotMatch(prompt,/seafood|pescad|aquicultur|pesca|Pescados Litoral|Rui Matos|Paulo Nunes/i,`${format}/${key}`);
    assert.match(prompt,/workspace|mapa editorial/);assert.match(prompt,/Não invente/);
    assert.match(prompt,/{{source}}/);
    assert.ok(KNOWN_DEFAULT_PROMPTS[`funnel:${format}:${key}`].includes(promptHash(prompt)));
  }
  const prompts=EDITORIAL_FORMATS.flatMap(format=>FUNNEL_STEP_KEYS.map(key=>[format,key,neutralFunnelPrompt(format,key)]));
  assert.equal(createHash('sha256').update(JSON.stringify(prompts)).digest('hex'),'ebf885a5a6df9c265d414b51abaf84fc165aa0975e85af9fa29882f0f3b54f52');
});
test('preset selection survives expansion, compaction and job snapshots while saved custom prompts remain exact',()=>{
  const base=defaultPipelineDefinition(),legacy=pipelineRevision(base),neutral={...base,funnelPreset:'neutral-v1' as const};
  const filled=withFormatFunnels(neutral);assert.equal(compactFunnels(filled).funnels,undefined);
  assert.doesNotMatch(formatPipelineDefinition(neutral,'opening').steps.intro.prompt,/seafood|aquicultur|pescad/i);
  filled.funnels.opening.intro.prompt+='\nCustom client instruction.';
  const compact=compactFunnels(filled),job=formatPipelineDefinition(compact,'opening');
  assert.equal(job.steps.intro.prompt,filled.funnels.opening.intro.prompt);
  assert.equal(pipelineRevision(base).hash,legacy.hash,'the preserved pilot definition is never enriched or rehashed');
  assert.notEqual(pipelineRevision(neutral).hash,legacy.hash);
  assert.deepEqual(upgradePreset(neutral).updated,[]);
  assert.doesNotMatch(formatPipelineDefinition(upgradePreset(filled).next,'opening').steps.intro.prompt,/seafood|aquicultur|pescad/i);
});
