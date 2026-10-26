import { randomUUID } from 'node:crypto';
import { expect,test } from '@playwright/test';

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
