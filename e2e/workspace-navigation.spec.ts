import {randomUUID} from 'node:crypto';
import {expect,test,type Page} from '@playwright/test';
import {expectHeadingOutline,expectNoHorizontalOverflow,watchErrors} from './support';

for(const width of [1440,390]){
  test.describe(`client navigation at ${width}`,()=>{
    test.use({viewport:{width,height:1000},...(width===390?{isMobile:true,hasTouch:true}:{})});
    test('keeps copied links, pending edits, two tabs and the last authorized destination in their client',async({page,context,request,baseURL})=>{
      test.skip(process.env.REPORTER_WORKSPACES_MODE!=='all','requires the isolated workspace rollout');
      const suffix=randomUUID().slice(0,8),headers={origin:baseURL!,'x-reporter-client':'local'},errors=watchErrors(page);
      const clients=[];
      for(const label of ['Alpha','Beta']){
        const created=await request.post('/api/reporter/platform/workspaces',{headers,data:{name:`000 Navigation ${label} ${suffix}`,slug:`nav-${label.toLowerCase()}-${suffix}`}});
        expect(created.status()).toBe(201);clients.push(await created.json());
      }
      const [a,b]=clients;
      const created=await request.post(`/api/reporter/w/${a.slug}/workspace`,{headers,data:{method:'createBlank',args:[{title:`Article ${suffix}`,brief:{size:'standard',sections:3}}],requestId:randomUUID()}});
      const production=(await created.json()).value;expect(production.productionId).toBeTruthy();
      async function menu(target:Page=page){
        const trigger=target.getByRole('button',{name:/Trocar workspace$/});
        if(!await trigger.isVisible())await target.getByRole('button',{name:'Abrir menu',exact:true}).click();
        await trigger.click();return target.getByRole('menu',{name:'Trocar workspace',exact:true});
      }
      await page.goto('/workspaces');await page.getByRole('searchbox',{name:'Buscar workspace',exact:true}).fill(a.name);
      const entry=page.getByRole('link',{name:new RegExp(a.name)});await expect(entry).toHaveAttribute('href',`/w/${a.slug}/`);
      await entry.focus();await entry.press('Enter');await expect(page).toHaveURL(new RegExp(`/w/${a.slug}/$`));
      await expectHeadingOutline(page);await expectNoHorizontalOverflow(page);
      if(width===390)await page.getByRole('button',{name:'Abrir menu',exact:true}).click();
      const link=page.getByRole('link',{name:'Produções',exact:true});await expect(link).toHaveAttribute('href',`/w/${a.slug}/productions`);
      const copied=await link.getAttribute('href'),other=await context.newPage();await other.goto(copied!);
      await expect(other).toHaveURL(new RegExp(`/w/${a.slug}/productions$`));
      await page.goto(`/w/${a.slug}/productions/${production.productionId}/article`);
      const editor=page.getByRole('textbox',{name:'Texto do artigo',exact:true});await expect(editor).toBeVisible();
      let release!:()=>void,intercept!:()=>void;
      const held=new Promise<void>(resolve=>{release=resolve;}),intercepted=new Promise<void>(resolve=>{intercept=resolve;});
      await page.route(`**/api/reporter/w/${a.slug}/workspace`,async route=>{
        if(route.request().method()!=='POST')return route.continue();
        const response=await route.fetch();intercept();await held;await route.fulfill({response});
      });
      await editor.click();await editor.press('ControlOrMeta+End');await editor.pressSequentially(`Saved before changing client ${suffix}`);
      await intercepted;
      await (await menu()).getByRole('menuitemradio',{name:new RegExp(b.name)}).click();
      await expect(page).toHaveURL(new RegExp(`/w/${a.slug}/`));release();
      await expect(page).toHaveURL(new RegExp(`/w/${b.slug}/$`));
      await expect(other).toHaveURL(new RegExp(`/w/${a.slug}/productions$`));
      const stored=await(await request.get(`/api/reporter/w/${a.slug}/workspace`,{headers})).json();expect(JSON.stringify(stored.state.productions)).toContain(`Saved before changing client ${suffix}`);
      await page.goto(`/w/${a.slug}/settings/writing-guide`);
      const voice=page.getByRole('textbox',{name:'Voz',exact:true});await voice.fill(`Unsaved policy ${suffix}`);
      await (await menu()).getByRole('menuitemradio',{name:new RegExp(b.name)}).click();
      const warning=page.getByRole('dialog',{name:'Sair sem salvar?',exact:true});await expect(warning).toBeVisible();
      await warning.getByRole('button',{name:'Continuar editando',exact:true}).click();await expect(voice).toHaveValue(`Unsaved policy ${suffix}`);
      await (await menu()).getByRole('menuitemradio',{name:new RegExp(b.name)}).click();await warning.getByRole('button',{name:'Descartar e sair',exact:true}).click();
      await expect(page).toHaveURL(new RegExp(`/w/${b.slug}/$`));
      await page.goto('/');await expect(page).toHaveURL(new RegExp(`/w/${b.slug}/$`));
      await menu();await page.screenshot({path:`.reporter-local/multi-workspace/m6-selector-${width}.png`,fullPage:true});await page.keyboard.press('Escape');
      await expectNoHorizontalOverflow(page);await other.close();expect(errors).toEqual([]);
    });
  });
}
