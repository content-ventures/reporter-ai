import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {handleWorkspaceTemplates} from '../src/server/template-settings.ts';
import { chromium } from '@playwright/test';
import { handleVisualLibrary } from '../src/server/visual-library.ts';
import { currentReporterContext,runWithReporterContext } from '../src/server/request-context.ts';

export async function validateExport(snapshot,productionId,readAsset) {
  const bundled=await build({stdin:{resolveDir:fileURLToPath(new URL('../',import.meta.url)),contents:`
    import {createEditorialEngine} from './src/runtime/editorial-engine.ts';
    import {createMemoryAssetStore} from './src/adapters/local/assets/index.ts';
    import {createLocalRenderService,assetCoverLoader,decodeBitmap} from './src/adapters/local/render/index.ts';
    import {createLocalExportService} from './src/adapters/local/export/index.ts';
    import {CAROUSEL_TEMPLATES,CAROUSEL_TEMPLATE_RENDERS,CAROUSEL_TEMPLATE_DESCRIPTIONS,CAROUSEL_TEMPLATE_LIBRARY} from './src/fixtures/templates/catalog.ts';
    import {workspaceTemplateLibrary} from './src/runtime/workspace-templates.ts';
    window.exportAcceptance=async ({snapshot,productionId,urls})=>{
      const clock={now:()=>new Date().toISOString()},ids={next:()=>crypto.randomUUID()};
      const assets=createMemoryAssetStore({clock,ids,workspaceId:snapshot.state.workspace.id,actorId:()=>snapshot.state.sessionPersonId,
        seed:snapshot.imageAssets.map(entry=>({...entry,src:urls[entry.asset.id]}))});await assets.ready();
      const engine=createEditorialEngine(snapshot,ids);
      const pack=snapshot.templateConfiguration?workspaceTemplateLibrary(snapshot.templateConfiguration):undefined;
      const render=createLocalRenderService({...(pack??{}),templates:pack?.templates??CAROUSEL_TEMPLATES,renders:pack?.renders??CAROUSEL_TEMPLATE_RENDERS,descriptions:CAROUSEL_TEMPLATE_DESCRIPTIONS,library:pack?.library??CAROUSEL_TEMPLATE_LIBRARY,loadCover:assetCoverLoader(assets),loadBrandLogo:async id=>{const response=await fetch('/acceptance-brand/'+id);if(!response.ok)return {ok:false,refusal:{code:'unavailable',message:'Brand unavailable'}};const bitmap=await decodeBitmap(await response.blob());return bitmap?{ok:true,value:bitmap}:{ok:false,refusal:{code:'unavailable',message:'Brand unavailable'}};}});
      const exporter=createLocalExportService({clock,getRecord:id=>engine.records.record(id),render,assets});
      const result=await exporter.build({productionId});
      if(!result.ok)throw new Error(result.refusal.code);
      const report={status:result.value.status,selection:result.value.plan.selection,files:result.value.files.map(file=>({fileName:file.fileName,href:file.href,format:file.format,status:file.status,bytes:file.bytes,error:file.error?.code})),outcomes:result.value.outcomes};
      assets.dispose();engine.store.dispose();return report;
    };`},bundle:true,platform:'browser',format:'iife',write:false,define:{'process.env.NEXT_PUBLIC_REPORTER_E2E_FIXTURES':'"false"','process.env.NEXT_PUBLIC_REPORTER_PREVIEW_RELEASE':'"R1"'}});
  const context=currentReporterContext(),urls={};for(const entry of snapshot.imageAssets??[])if(entry.fileKey)urls[entry.asset.id]='/api/reporter/visuals/assets/'+entry.asset.id+'/file';
  const directory=await mkdtemp(join(tmpdir(),'reporter-export-'));
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort());
    await page.route('https://reporter-ai-three.vercel.app/acceptance-export',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body>Isolated export acceptance</body></html>'}));
    await page.route('https://reporter-ai-three.vercel.app/api/reporter/visuals/assets/*/file',async route=>{
      const id=new URL(route.request().url()).pathname.split('/').at(-2);
      const response=readAsset?await readAsset(id):await runWithReporterContext(context,()=>handleVisualLibrary(new Request(route.request().url()),['assets',id,'file'],async()=>({})));
      await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
    });
    await page.route('https://reporter-ai-three.vercel.app/acceptance-brand/*',async route=>{const id=new URL(route.request().url()).pathname.split('/').at(-1);const response=await runWithReporterContext(context,()=>handleWorkspaceTemplates(new Request(route.request().url()),['logos',id],async()=>({})));await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
    await page.goto('https://reporter-ai-three.vercel.app/acceptance-export');await page.addScriptTag({content:bundled.outputFiles[0].text});
    assert.deepEqual(errors,[],'Export browser script failed');
    const report=await page.evaluate(input=>window.exportAcceptance(input),{snapshot,productionId,urls});
    assert.equal(report.status,'completed',JSON.stringify({status:report.status,files:report.files.map(({href,...file})=>file)}));
    for(const format of ['md','html','json','png'])assert.ok(report.files.some(file=>file.format===format&&file.status==='ready'&&file.bytes>0),'Missing '+format+' export');
    for(const file of report.files.filter(file=>file.status==='ready')){
      assert.ok(file.href,'A ready export must have its download URL');
      const pending=page.waitForEvent('download');
      await page.evaluate(file=>{const link=document.createElement('a');link.href=file.href;link.download=file.fileName;document.body.append(link);link.click();link.remove();},file);
      const download=await pending;assert.equal(await download.failure(),null);
      const path=join(directory,download.suggestedFilename());await download.saveAs(path);const bytes=await readFile(path);assert.equal(bytes.length,file.bytes);
      if(file.fileName.startsWith('manifest')){const manifest=JSON.parse(bytes.toString());assert.equal(manifest.workspaceId,snapshot.state.workspace.id);assert.equal(manifest.production.id,productionId);}
      if(file.format==='png'){const metadata=await sharp(bytes).metadata();assert.ok(metadata.width>0&&metadata.height>0);}
      if(file.format==='json'&&!file.fileName.startsWith('manifest')&&snapshot.templateConfiguration&&!snapshot.templateConfiguration.pilot)assert.ok(JSON.parse(bytes.toString()).templateId.startsWith('wst-'+snapshot.state.workspace.id+'-'));
      delete file.href;
    }
    console.log('PASS browser export of approved article, images, carousel PNGs, JSON and manifest.');
    return report;
  }finally{await browser.close();await rm(directory,{recursive:true,force:true});}
}
