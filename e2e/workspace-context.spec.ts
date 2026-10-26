import { randomUUID } from 'node:crypto';
import { expect,test } from '@playwright/test';
import sharp from 'sharp';

test('two canonical client addresses keep drafts, requests and image caches separate in the same browser',async({browser,request,baseURL})=>{
  test.skip(process.env.REPORTER_WORKSPACES_MODE!=='all','workspace acceptance requires the isolated rollout mode');
  const headers={origin:baseURL!,'x-reporter-client':'local'};
  async function client(label:string){
    const slug=`browser-${label}-${Date.now()}`;
    const created=await request.post('/api/reporter/platform/workspaces',{headers,data:{name:`Browser client ${label}`,slug}});
    expect(created.status()).toBe(201);const workspace=await created.json();
    expect((await request.post(`/api/reporter/platform/workspaces/${workspace.id}/update`,{headers,data:{name:workspace.name,status:'active',revision:workspace.revision}})).ok()).toBeTruthy();
    const production=await request.post(`/api/reporter/w/${slug}/workspace`,{headers,data:{method:'createBlank',args:[{title:`Draft ${label}`,brief:{size:'standard',sections:3}}],requestId:randomUUID()}});
    expect(production.ok()).toBeTruthy();const result=await production.json();expect(result.ok).toBe(true);
    return{...workspace,slug,productionId:result.value.productionId};
  }
  const a=await client('one'),b=await client('two');
  const context=await browser.newContext({baseURL,viewport:{width:1440,height:900}});
  try{
    const pageA=await context.newPage(),pageB=await context.newPage();
    const writes:{page:string;path:string}[]=[];
    for(const[label,page]of[['one',pageA],['two',pageB]]as const) page.on('request',event=>{
      if(event.method()==='POST'&&event.url().includes('/api/reporter/')) writes.push({page:label,path:new URL(event.url()).pathname});
    });
    await Promise.all([pageA.goto(`/w/${a.slug}/productions/${a.productionId}/article`),pageB.goto(`/w/${b.slug}/productions/${b.productionId}/article`)]);
    for(const[page,workspace,text]of[[pageA,a,'Text belonging to client one'],[pageB,b,'Text belonging to client two']]as const){
      const editor=page.getByRole('textbox',{name:'Texto do artigo'});await expect(editor).toBeVisible();
      const saved=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/reporter/w/${workspace.slug}/workspace`&&response.request().method()==='POST');
      await editor.click();await editor.press('ControlOrMeta+End');await editor.pressSequentially(text);
      expect((await saved).ok()).toBeTruthy();
    }
    const stateA=await(await request.get(`/api/reporter/w/${a.slug}/workspace`,{headers})).json();
    const stateB=await(await request.get(`/api/reporter/w/${b.slug}/workspace`,{headers})).json();
    expect(JSON.stringify(stateA.state.productions)).toContain('Text belonging to client one');
    expect(JSON.stringify(stateA.state.productions)).not.toContain('Text belonging to client two');
    expect(JSON.stringify(stateB.state.productions)).toContain('Text belonging to client two');
    expect(JSON.stringify(stateB.state.productions)).not.toContain('Text belonging to client one');
    expect(writes.filter(item=>item.page==='one').every(item=>item.path.startsWith(`/api/reporter/w/${a.slug}/`))).toBe(true);
    expect(writes.filter(item=>item.page==='two').every(item=>item.path.startsWith(`/api/reporter/w/${b.slug}/`))).toBe(true);
    await expect.poll(async()=>pageA.evaluate(async()=> (await indexedDB.databases()).map(db=>db.name))).toEqual(expect.arrayContaining([
      `reporter-assets:${a.id}:00000000-0000-0000-0000-000000000031`,`reporter-assets:${b.id}:00000000-0000-0000-0000-000000000031`,
    ]));
    await pageA.reload();await expect(pageA.getByRole('textbox',{name:'Texto do artigo'})).toContainText('Text belonging to client one');
  }finally{await context.close();}
});

test('each client library draws its own private brand and never offers the Seafood catalog',async({browser,request,baseURL})=>{
  test.skip(process.env.REPORTER_WORKSPACES_MODE!=='all','workspace acceptance requires the isolated rollout mode');
  const headers={origin:baseURL!,'x-reporter-client':'local'},clients=[];
  for(const [label,color]of [['Alpha',{r:208,g:48,b:48}],['Beta',{r:32,g:92,b:200}]]as const){
    const slug=`brand-${label.toLowerCase()}-${Date.now()}`;
    const created=await request.post('/api/reporter/platform/workspaces',{headers,data:{name:`Publication ${label}`,slug}});expect(created.status()).toBe(201);
    const workspace=await created.json();
    const bytes=await sharp({create:{width:40,height:40,channels:4,background:{...color,alpha:1}}}).png().toBuffer();
    const upload=await request.post(`/api/reporter/platform/workspaces/${workspace.id}/logo`,{headers:{...headers,'content-type':'image/png'},data:bytes});expect(upload.status()).toBe(201);
    const logo=await upload.json();
    const saved=await request.post(`/api/reporter/platform/workspaces/${workspace.id}/templates`,{headers,data:{revision:workspace.revision,
      config:{publication:`Publication ${label}`,presets:['editorial'],defaultPreset:'editorial',font:'Montserrat',logoId:logo.id}}});expect(saved.ok()).toBeTruthy();
    clients.push({...workspace,slug,color,label});
  }
  const context=await browser.newContext({baseURL,viewport:{width:1440,height:900}});
  try{
    for(const client of clients){
      const page=await context.newPage();await page.goto(`/w/${client.slug}/library/templates`);
      const cards=page.getByRole('list',{name:/^Modelos/}).getByRole('listitem');await expect(cards).toHaveCount(1);
      await expect(page.getByRole('main')).not.toContainText('Seafood');await expect(page.getByRole('main')).not.toContainText(`Publication ${client.label==='Alpha'?'Beta':'Alpha'}`);
      await cards.getByRole('link',{name:new RegExp(`Publication ${client.label}`)}).click();
      await expect(page).toHaveURL(new RegExp(`/w/${client.slug}/library/templates\\?`));
      const image=page.getByRole('img',{name:/no modelo/}).first();await expect(image).toHaveAttribute('src',/^data:image\/png/);
      const data=(await image.getAttribute('src'))!.split(',')[1],png=sharp(Buffer.from(data,'base64')),metadata=await png.metadata(),scale=metadata.width!/1080;
      const pixel=await png.extract({left:Math.round(110*scale),top:Math.round(48*scale),width:1,height:1}).removeAlpha().raw().toBuffer();
      expect([...pixel]).toEqual([client.color.r,client.color.g,client.color.b]);
      await page.screenshot({path:`.reporter-local/multi-workspace/m4-brand-${client.label.toLowerCase()}.png`,fullPage:true});
    }
  }finally{await context.close();}
});
