import {fork,type ChildProcess} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import {expect,test,type Browser,type BrowserContext,type Download,type Page,type TestInfo} from '@playwright/test';
import sharp from 'sharp';
import type {ScenarioActor} from '../tests/support/workspace-scenario';
import type {DeliveryManifest} from '../src/domain/manifest';
import type {CarouselExport} from '../src/adapters/local/export/carousel-json';
import {expectLoaded,expectNoHorizontalOverflow,watchErrors} from './support';

type Client={id:string;slug:string;name:string;marker:string;color:{r:number;g:number;b:number};templateId:string};
type Production={id:string;workspaceId:string;slug:string;client:number;event:string;editorId:string;reviewerId:string;assetId:string;photoHash:string;title:string};
type Journey={type:'ready';base:string;clients:Client[];productions:Production[];editors:ScenarioActor[];reviewers:ScenarioActor[];administrator:ScenarioActor;pendingActor:ScenarioActor};
let child:ChildProcess|undefined,journey:Journey;

test.describe('real multi-client editorial delivery',()=>{
  test.describe.configure({mode:'serial'});
  test.beforeAll(async({},info)=>{
    test.skip(process.env.REPORTER_WORKSPACES_MODE!=='all','requires the isolated workspace rollout');
    const log=createWriteStream(info.outputPath('journey-server.log'));
    child=fork('tests/acceptance/workspace-journey-server.ts',[],{execArgv:['--conditions=react-server','--import','tsx'],
      env:{...process.env,REPORTER_TEST_FRONTEND_ORIGIN:String(info.project.use.baseURL)},stdio:['ignore','pipe','pipe','ipc']});
    child.stdout!.pipe(log);child.stderr!.pipe(log);
    journey=await new Promise<Journey>((resolve,reject)=>{
      child!.on('message',(message:Journey|{type:'failed';message:string})=>{if(message.type==='ready')resolve(message);else reject(new Error(message.message));});
      child!.once('exit',code=>reject(new Error(`Journey setup exited with ${code}; see journey-server.log`)));
    });
  });
  test.afterAll(async()=>{
    if(!child||child.exitCode!==null)return;
    const exit=once(child,'exit');child.send({type:'stop'});await exit;
  });
  async function actorContext(browser:Browser,baseURL:string,actor:ScenarioActor,width=1440):Promise<BrowserContext>{
    const context=await browser.newContext({baseURL,acceptDownloads:true,viewport:{width,height:1000},...(width===390?{isMobile:true,hasTouch:true}:{})});
    await context.route('**/api/reporter/**',async route=>{
      const url=new URL(route.request().url());
      const response=await route.fetch({url:journey.base+url.pathname+url.search,headers:{...route.request().headers(),'x-reporter-acceptance-session':actor.token}});
      await route.fulfill({response});
    });
    return context;
  }
  async function ready(page:Page,production:Production){
    await page.goto(`/w/${production.slug}/productions/${production.id}/delivery`);
    for(const suffix of [/\.md$/, /\.html$/, /manifest[^ ]*\.json$/, /\.png$/])
      await expect(page.getByRole('link',{name:new RegExp(`^Baixar .*${suffix.source}`)}).first()).toBeVisible();
    await expectLoaded(page);
  }
  async function verify(downloads:Download[],production:Production,info:TestInfo){
    const client=journey.clients[production.client],foreign=journey.clients[1-production.client];
    const files=new Map<string,Buffer>();
    for(const download of downloads){const name=download.suggestedFilename();expect(await download.failure(),name).toBeNull();await download.saveAs(info.outputPath(production.id+'-'+name));files.set(name,await readFile(info.outputPath(production.id+'-'+name)));}
    for(const suffix of ['.md','.html']){
      const text=[...files].find(([name])=>name.endsWith(suffix))![1].toString();
      expect(text).toContain(production.event);expect(text).toContain(client.name);expect(text).not.toContain(foreign.name);expect(text).not.toContain('Seafood');
      expect(text).toContain('A previsão depende de testes reais.');expect(text).toContain(`Imagem de teste ${production.client===0?'Alpha':'Beta'}`);
    }
    const manifest=JSON.parse([...files].find(([name])=>/^manifest.*\.json$/.test(name))![1].toString()) as DeliveryManifest;
    expect(manifest.workspaceId).toBe(client.id);expect(manifest.production.id).toBe(production.id);
    expect(manifest.items.find(item=>item.kind==='article')!.approvedBy).toBe(production.reviewerId);
    expect(manifest.items.every(item=>item.approvedBy!==production.editorId)).toBe(true);
    expect(manifest.runs.every(run=>run.configuration?.workspaceId===client.id)).toBe(true);
    expect(manifest.assets.find(asset=>asset.id===production.assetId)?.sha256).toBe(production.photoHash);
    const carousel=JSON.parse([...files].find(([name])=>name.endsWith('.json')&&!name.startsWith('manifest'))![1].toString()) as CarouselExport;
    expect(carousel.templateId).toBe(client.templateId);expect(carousel.templateId).not.toBe(foreign.templateId);
    const pngs=[...files].filter(([name])=>name.endsWith('.png'));let photos=0,slides=0;
    for(const[,bytes]of pngs){
      const image=sharp(bytes),metadata=await image.metadata();
      if(metadata.width===1280){expect(createHash('sha256').update(bytes).digest('hex')).toBe(production.photoHash);photos++;continue;}
      expect([metadata.width,metadata.height]).toEqual([1080,1350]);
      const pixel=await image.extract({left:110,top:48,width:1,height:1}).removeAlpha().raw().toBuffer();
      expect([...pixel]).toEqual([client.color.r,client.color.g,client.color.b]);slides++;
    }
    expect(photos).toBe(1);expect(slides).toBe(carousel.slides.length);
  }
  test('leaving delivery stops late downloads and delivery receipts',async({browser,baseURL})=>{
    const context=await actorContext(browser,baseURL!,journey.editors[0]);
    try{
      const page=await context.newPage(),production=journey.productions[0],downloads:Download[]=[];
      await ready(page,production);await page.getByRole('link',{name:'Produções',exact:true}).first().hover();
      let receipts=0;page.on('request',request=>{if(request.method()==='POST'&&request.postDataJSON()?.method==='recordDelivery')receipts++;});
      page.on('download',download=>downloads.push(download));
      const first=page.waitForEvent('download');await page.getByRole('button',{name:'Baixar pacote',exact:true}).first().click();await first;
      await page.getByRole('link',{name:'Produções',exact:true}).first().click();
      await expect(page.getByRole('heading',{level:1,name:'Produções',exact:true})).toBeVisible();
      const count=downloads.length;
      await page.waitForTimeout(750); // Covers the existing 220 ms download gap after the screen has unmounted.
      expect(downloads.length).toBe(count);expect(receipts).toBe(0);
      await expect(page.getByText(/Pacote baixado ·/)).toHaveCount(0);
    }finally{await context.close();}
  });
  for(const width of [1440,390])test(`exports actual approved client files at ${width}`,async({browser,baseURL},info)=>{
    // Alpha owns two coverages in one workspace; Beta is a separate client with a different identity.
    const contexts:BrowserContext[]=[];
    try{
      for(const production of journey.productions){
        const context=await actorContext(browser,baseURL!,journey.editors[production.client],width);contexts.push(context);
        const page=await context.newPage(),errors=watchErrors(page);await ready(page,production);
        const count=await page.getByRole('link',{name:/^Baixar /}).count(),downloads:Download[]=[];page.on('download',download=>downloads.push(download));
        await page.getByRole('button',{name:'Baixar pacote',exact:true}).first().click();
        await expect(page.getByText(`Pacote baixado · ${count} arquivos`,{exact:true}).first()).toBeVisible();
        await expect.poll(()=>downloads.length).toBe(count);await verify(downloads,production,info);
        await expectNoHorizontalOverflow(page);expect(errors).toEqual([]);
        await page.screenshot({path:info.outputPath(`delivery-${production.client}-${width}.png`),fullPage:true,animations:'disabled'});
        await context.close();
      }
    }finally{await Promise.all(contexts.map(context=>context.close()));}
  });
  test('client administrators and accounts without membership see only their authorized entry',async({browser,baseURL})=>{
    for(const actor of [journey.administrator,journey.pendingActor]){
      const context=await actorContext(browser,baseURL!,actor);
      try{
        const page=await context.newPage();await page.goto('/workspaces');
        await expect(page.getByRole('heading',{level:1,name:'Escolher workspace',exact:true})).toBeVisible();
        await expect(page.getByRole('link',{name:'Plataforma',exact:true})).toHaveCount(0);
        await expect(page.getByRole('link',{name:new RegExp(journey.clients[1].name)})).toHaveCount(0);
        if(actor===journey.pendingActor){
          await expect(page.getByText('Nenhum workspace liberado',{exact:true})).toBeVisible();
          await expect(page.getByRole('link',{name:new RegExp(journey.clients[0].name)})).toHaveCount(0);
        }else{
          await expect(page.getByRole('link',{name:new RegExp(journey.clients[0].name)})).toBeVisible();
          await page.goto(`/w/${journey.clients[0].slug}/admin/workspace`);
          await expect(page.getByRole('textbox',{name:'Nome do veículo',exact:true})).toBeEnabled();
        }
        expect(await page.evaluate(async()=> (await fetch('/api/reporter/platform/workspaces')).status)).toBe(403);
      }finally{await context.close();}
    }
  });
  test('an in-progress private upload remains in its client and prevents an unconfirmed unload',async({browser,baseURL})=>{
    const actor=journey.editors[0],a=journey.clients[0],b=journey.clients[1],context=await actorContext(browser,baseURL!,actor);
    let release=()=>{};
    try{
      const created=await context.request.post(journey.base+`/api/reporter/w/${a.slug}/workspace`,{headers:{origin:baseURL!,'x-reporter-acceptance-session':actor.token,'x-reporter-account':actor.id},data:{method:'createBlank',args:[{title:'Pending upload boundary',brief:{size:'standard',sections:3}}],requestId:randomUUID()}});
      expect(created.ok()).toBe(true);const productionId=(await created.json()).value.productionId;
      const page=await context.newPage();await page.goto(`/w/${a.slug}/productions/${productionId}/article`);
      await page.getByRole('button',{name:'Adicionar imagem de destaque',exact:true}).first().click();
      const picker=page.getByRole('dialog',{name:'Imagem de destaque',exact:true});await expect(picker).toBeVisible();
      const image=await sharp({create:{width:40,height:40,channels:3,background:a.color}}).png().toBuffer();
      await picker.locator('input[type="file"]').setInputFiles({name:'held-upload.png',mimeType:'image/png',buffer:image});
      await picker.getByRole('textbox',{name:'Crédito',exact:true}).fill('Authorized synthetic upload');
      await picker.getByRole('switch',{name:'Uso autorizado',exact:true}).check();
      const held=new Promise<void>(resolve=>{release=resolve;}),arrived=Promise.withResolvers<void>();
      await page.route(`**/api/reporter/w/${a.slug}/visuals/assets/complete`,async route=>{
        const response=await route.fetch({url:journey.base+new URL(route.request().url()).pathname,headers:{...route.request().headers(),'x-reporter-acceptance-session':actor.token}});
        expect(response.ok()).toBe(true);arrived.resolve();await held;await route.fulfill({response});
      });
      await picker.getByRole('button',{name:'Definir como destaque',exact:true}).click();await arrived.promise;
      const dialog=page.waitForEvent('dialog');const navigation=page.goto(`/w/${b.slug}/`).catch(()=>null);
      const warning=await dialog;expect(warning.type()).toBe('beforeunload');await warning.dismiss();await navigation;
      await expect(page).toHaveURL(new RegExp(`/w/${a.slug}/`));release();await expect(picker).toBeHidden();
      await page.getByRole('button',{name:/Trocar workspace$/}).click();await page.getByRole('menuitemradio',{name:new RegExp(b.name)}).click();
      await expect(page).toHaveURL(new RegExp(`/w/${b.slug}/?$`));
      expect(await page.evaluate(async path=>JSON.stringify(await(await fetch(path)).json()),`/api/reporter/w/${b.slug}/workspace`)).not.toContain('held-upload.png');
      await page.goto(`/w/${a.slug}/productions/${productionId}/article`);await expect(page.getByRole('toolbar',{name:'Imagem de destaque',exact:true})).toContainText('Authorized synthetic upload');
    }finally{release();await context.close();}
  });
  test('the same signed-in account keeps client roles and colliding private image IDs separate',async({browser,baseURL})=>{
    const context=await actorContext(browser,baseURL!,journey.editors[0]);
    try{
      const page=await context.newPage();
      for(const[index,production]of journey.productions.slice(0,2).entries()){
        await page.goto(`/w/${production.slug}/productions`);await expect(page.getByRole('heading',{level:1,name:'Produções',exact:true})).toBeVisible();
        await expect(page.getByRole('button',{name:'Nova produção',exact:true}).or(page.getByRole('link',{name:'Nova produção',exact:true}))).toHaveCount(index===0?1:0);
        const bytes=await page.evaluate(async path=>Array.from(new Uint8Array(await(await fetch(path)).arrayBuffer())),`/api/reporter/w/${production.slug}/visuals/assets/${production.assetId}/file`);
        expect(createHash('sha256').update(Buffer.from(bytes)).digest('hex')).toBe(production.photoHash);
      }
    }finally{await context.close();}
  });
});
