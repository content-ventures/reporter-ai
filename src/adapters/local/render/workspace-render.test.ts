import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ok,refuse} from '../../../domain/result.ts';
import type {WorkspaceTemplateRevision} from '../../../domain/workspace-templates.ts';
import {workspaceTemplateEntries} from '../../../fixtures/templates/workspace.ts';
import {createLocalRenderService} from './local-render.ts';
import type {Canvas2D,SurfaceFactory} from './canvas.ts';

const revision:WorkspaceTemplateRevision={workspaceId:'20000000-0000-0000-0000-000000000101',hash:'0123456789abcdef',renderer:'workspace-v1',revision:1,savedAt:'2026-10-26T00:00:00Z',savedBy:'operator',
  config:{publication:'Naturaltech',presets:['editorial'],defaultPreset:'editorial',font:'Montserrat',logoId:'20000000-0000-0000-0000-000000000201'}};
test('client raster draws its publication and contained transparent logo on every selected slide',async()=>{
  const [entry]=workspaceTemplateEntries(revision),texts:string[]=[],images:unknown[][]=[],fonts:string[]=[];let loads=0;
  const surface:SurfaceFactory=()=>{
    const context:Canvas2D={fillStyle:'',font:'',textAlign:'left',textBaseline:'top',fillRect(){},fillText(text){texts.push(text);},
      measureText(text){return{width:text.length*10};},drawImage(...args){images.push(args);}};
    return{context,toPng:async()=>new Uint8Array([137,80,78,71])};
  };
  const render=createLocalRenderService({templates:[entry.template],renders:{[entry.template.id]:entry.render},library:{[entry.template.id]:{meta:entry.meta,sample:entry.sample}},
    activeTemplateIds:[],createSurface:surface,fontsReady:async values=>{fonts.push(...values);},loadBrandLogo:async id=>{assert.equal(id,revision.config.logoId);loads++;return ok({source:'private-brand',width:400,height:100});}});
  assert.deepEqual(render.templates(),[]);assert.match(render.templateInfo?.(entry.template.id)?.name??'',/Naturaltech/);
  const sample=render.sample(entry.template.id);assert.ok(sample.ok);if(!sample.ok)return;
  const result=await render.render({body:sample.value,scale:.5});assert.ok(result.ok);assert.equal(loads,1);
  assert.ok(texts.filter(text=>text==='Naturaltech').length>=sample.value.slides.length);assert.ok(!texts.includes('Naturaltech…'));
  assert.equal(images.length,sample.value.slides.length);assert.equal(images[0][0],'private-brand');
  assert.equal(Number(images[0][7])/Number(images[0][8]),4,'the logo is contained without cropping or distorting its proportions');
  assert.ok(fonts.some(font=>font.includes('600 16px Montserrat')));
});
test('a configured brand failure prevents a false successful export; history is renderable but not assignable',async()=>{
  const [entry]=workspaceTemplateEntries(revision);
  const render=createLocalRenderService({templates:[entry.template],renders:{[entry.template.id]:entry.render},activeTemplateIds:[],loadBrandLogo:async()=>refuse('missing','Revoked access')});
  assert.deepEqual(render.templates(),[]);const sample=render.sample(entry.template.id);assert.ok(sample.ok);if(!sample.ok)return;
  assert.equal(render.templateInfo?.(entry.template.id)?.id,entry.template.id);assert.deepEqual(render.retainedTemplateIds?.(),[entry.template.id]);
  assert.equal(render.switchTemplate(sample.value,entry.template.id).ok,false);
  const failed=await render.render({body:sample.value});assert.equal(failed.ok,false);if(!failed.ok)assert.equal(failed.refusal.code,'render_failed');
});
