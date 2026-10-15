import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { imageFileUrl } from '../src/server/image-storage.ts';

export async function validateExport(snapshot,productionId) {
  const bundled=await build({stdin:{resolveDir:process.cwd(),contents:`
    import {createEditorialEngine} from './src/runtime/editorial-engine.ts';
    import {createMemoryAssetStore} from './src/adapters/local/assets/index.ts';
    import {createLocalRenderService,assetCoverLoader} from './src/adapters/local/render/index.ts';
    import {createLocalExportService} from './src/adapters/local/export/index.ts';
    import {CAROUSEL_TEMPLATES,CAROUSEL_TEMPLATE_RENDERS,CAROUSEL_TEMPLATE_DESCRIPTIONS,CAROUSEL_TEMPLATE_LIBRARY} from './src/fixtures/templates/catalog.ts';
    window.exportAcceptance=async ({snapshot,productionId,urls})=>{
      const clock={now:()=>new Date().toISOString()},ids={next:()=>crypto.randomUUID()};
      const assets=createMemoryAssetStore({clock,ids,workspaceId:snapshot.state.workspace.id,actorId:()=>snapshot.state.sessionPersonId,
        seed:snapshot.imageAssets.map(entry=>({...entry,src:urls[entry.asset.id]}))});await assets.ready();
      const engine=createEditorialEngine(snapshot,ids);
      const render=createLocalRenderService({templates:CAROUSEL_TEMPLATES,renders:CAROUSEL_TEMPLATE_RENDERS,descriptions:CAROUSEL_TEMPLATE_DESCRIPTIONS,library:CAROUSEL_TEMPLATE_LIBRARY,loadCover:assetCoverLoader(assets)});
      const exporter=createLocalExportService({clock,getRecord:id=>engine.records.record(id),render,assets});
      const result=await exporter.build({productionId});
      if(!result.ok)throw new Error(result.refusal.code);
      const report={status:result.value.status,files:result.value.files.map(file=>({format:file.format,status:file.status,bytes:file.bytes,error:file.error?.code})),outcomes:result.value.outcomes};
      assets.dispose();engine.store.dispose();return report;
    };`},bundle:true,platform:'browser',format:'iife',write:false});
  const urls={};for(const entry of snapshot.imageAssets??[])if(entry.fileKey)urls[entry.asset.id]=await imageFileUrl(entry.fileKey);
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();await page.route('https://reporter-ai-three.vercel.app/acceptance-export',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body>Isolated export acceptance</body></html>'}));
    await page.goto('https://reporter-ai-three.vercel.app/acceptance-export');await page.addScriptTag({content:bundled.outputFiles[0].text});
    const report=await page.evaluate(input=>window.exportAcceptance(input),{snapshot,productionId,urls});
    assert.equal(report.status,'completed',JSON.stringify(report));
    for(const format of ['md','html','json','png'])assert.ok(report.files.some(file=>file.format===format&&file.status==='ready'&&file.bytes>0),'Missing '+format+' export');
    console.log('PASS browser export of approved article, images, carousel PNGs, JSON and manifest.');
    return report;
  }finally{await browser.close();}
}
