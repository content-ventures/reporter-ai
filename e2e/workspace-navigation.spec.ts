import {randomUUID} from 'node:crypto';
import {expect,test,type Page} from '@playwright/test';
import {expectHeadingOutline,expectLoaded,expectNoHorizontalOverflow,watchErrors} from './support';

for(const width of [1440,390]){
  test.describe(`client navigation at ${width}`,()=>{
    test.use({viewport:{width,height:1000},...(width===390?{isMobile:true,hasTouch:true}:{})});
    test('keeps copied links, pending edits, two tabs and the last authorized destination in their client',async({page,context,request,baseURL})=>{
      test.skip(process.env.REPORTER_WORKSPACES_MODE!=='all','requires the isolated workspace rollout');
      const suffix=randomUUID().slice(0,8),headers={origin:baseURL!,'x-reporter-client':'local'},errors=watchErrors(page,[/404.*\/w\//]);
      const clients=[];
      for(const label of ['Alpha','Beta']){
        const created=await request.post('/api/reporter/platform/workspaces',{headers,data:{name:`000 Navigation ${label} ${suffix}`,slug:`nav-${label.toLowerCase()}-${suffix}`}});
        expect(created.status()).toBe(201);clients.push(await created.json());
      }
      const [a,b]=clients;
      const created=await request.post(`/api/reporter/w/${a.slug}/workspace`,{headers,data:{method:'createBlank',args:[{title:`Article ${suffix}`,brief:{size:'standard',sections:3}}],requestId:randomUUID()}});
      const production=(await created.json()).value;expect(production.productionId).toBeTruthy();
      async function menu(target:Page=page){
        await expect(target.locator('[data-part="switcher"]')).toHaveAttribute('aria-label',/Trocar workspace$/);
        const trigger=target.getByRole('button',{name:/Trocar workspace$/});
        if(width===390){const opener=target.getByRole('button',{name:'Abrir menu',exact:true});if(await opener.getAttribute('aria-expanded')!=='true')await opener.click();}
        await trigger.click();return target.getByRole('menu',{name:'Trocar workspace',exact:true});
      }
      let capturedPicker=false;
      async function choice(item:{name:string},target:Page=page){
        const quick=await menu(target),option=quick.getByRole('menuitemradio',{name:new RegExp(item.name)});
        if(await option.count())return option;
        await quick.getByRole('menuitem',{name:'Ver todos os workspaces',exact:true}).click();
        const picker=target.getByRole('dialog',{name:'Trocar workspace',exact:true});await picker.getByRole('searchbox',{name:'Buscar workspace',exact:true}).fill(item.name);
        const result=picker.getByRole('button',{name:new RegExp(item.name)});
        if(!capturedPicker){await expect(result).toBeVisible();await target.screenshot({path:`.reporter-local/multi-workspace/m6-picker-${width}.png`,animations:'disabled'});capturedPicker=true;}
        return result;
      }
      await page.goto('/workspaces');await page.getByRole('searchbox',{name:'Buscar workspace',exact:true}).fill(a.name);
      const entry=page.getByRole('link',{name:new RegExp(a.name)});await expect(entry).toHaveAttribute('href',`/w/${a.slug}/`);
      await entry.focus();await entry.press('Enter');await expect(page).toHaveURL(new RegExp(`/w/${a.slug}/?$`));
      await expect(page.getByRole('heading',{level:1})).toBeVisible();await expectLoaded(page);await expectHeadingOutline(page);await expectNoHorizontalOverflow(page);
      if(width===390)await page.getByRole('button',{name:'Abrir menu',exact:true}).click();
      const link=page.getByRole('link',{name:'Produções',exact:true});await expect(link).toHaveAttribute('href',`/w/${a.slug}/productions`);
      const copied=await link.getAttribute('href');
      const other=width===1440?(await Promise.all([context.waitForEvent('page'),link.click({modifiers:['ControlOrMeta']})]))[0]:await context.newPage();
      const dialogs:string[]=[];other.on('dialog',dialog=>{dialogs.push(dialog.type());void dialog.dismiss();});
      if(width===390)await other.goto(copied!);
      await expect(other).toHaveURL(new RegExp(`/w/${a.slug}/productions$`));
      await page.goto(`/w/${a.slug}/productions/${production.productionId}/article`);
      const editor=page.getByRole('textbox',{name:'Texto do artigo',exact:true});await expect(editor).toBeVisible();
      let release!:()=>void,intercept!:()=>void;
      const held=new Promise<void>(resolve=>{release=resolve;}),intercepted=new Promise<void>(resolve=>{intercept=resolve;});
      await page.route(`**/api/reporter/w/${a.slug}/workspace`,async route=>{
        if(route.request().method()!=='POST')return route.continue();
        const response=await route.fetch({maxRetries:1});intercept();await held;await route.fulfill({response});
      });
      await editor.click();await editor.press('ControlOrMeta+End');await editor.pressSequentially(`Saved before changing client ${suffix}`);
      await intercepted;
      await (await choice(b)).click();
      await expect(page).toHaveURL(new RegExp(`/w/${a.slug}/`));release();
      await expect(page).toHaveURL(new RegExp(`/w/${b.slug}/?$`));
      await expect(other).toHaveURL(new RegExp(`/w/${a.slug}/productions$`));
      const stored=await(await request.get(`/api/reporter/w/${a.slug}/workspace`,{headers})).json();expect(JSON.stringify(stored.state.productions)).toContain(`Saved before changing client ${suffix}`);
      await page.goto(`/w/${a.slug}/settings/writing-guide`);
      const voice=page.getByRole('textbox',{name:'Voz',exact:true});await voice.fill(`Unsaved policy ${suffix}`);
      await (await choice(b)).click();
      const warning=page.getByRole('dialog',{name:'Sair sem salvar?',exact:true});await expect(warning).toBeVisible();
      await warning.getByRole('button',{name:'Continuar editando',exact:true}).click();await expect(voice).toHaveValue(`Unsaved policy ${suffix}`);
      await (await choice(b)).click();await warning.getByRole('button',{name:'Descartar e sair',exact:true}).click();
      await expect(page).toHaveURL(new RegExp(`/w/${b.slug}/?$`));
      await expect(page.locator('[data-part="switcher"]')).toHaveAttribute('aria-label',new RegExp(b.name));
      await page.goto('/');await expect(page).toHaveURL(new RegExp(`/w/${b.slug}/?$`));
      await menu();await page.screenshot({path:`.reporter-local/multi-workspace/m6-selector-${width}.png`,fullPage:true,animations:'disabled'});await page.keyboard.press('Escape');
      await expectNoHorizontalOverflow(page);
      const otherErrors=watchErrors(other,[/503.*workspace/]);
      await other.goto(`/w/${a.slug}/productions/${production.productionId}/article`);
      await other.route(`**/api/reporter/w/${a.slug}/workspace`,route=>route.request().method()==='POST'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'SAVE_UNCONFIRMED',message:'Synthetic interrupted save'})}):route.continue());
      const failedEditor=other.getByRole('textbox',{name:'Texto do artigo',exact:true});await expect(failedEditor).toBeVisible();await failedEditor.click();await failedEditor.press('ControlOrMeta+End');await failedEditor.pressSequentially(` Unconfirmed text ${suffix}`);
      await expect(other.getByText('Não foi possível salvar',{exact:true}).first()).toBeVisible();
      await (await choice(b,other)).click();
      const unconfirmed=other.getByRole('dialog',{name:'Sair sem confirmar o salvamento?',exact:true});await expect(unconfirmed).toBeVisible();await unconfirmed.getByRole('button',{name:'Continuar editando',exact:true}).click();await expect(failedEditor).toContainText(`Unconfirmed text ${suffix}`);
      await (await choice(b,other)).click();await unconfirmed.getByRole('button',{name:'Sair mesmo assim',exact:true}).click();
      await expect(other).toHaveURL(new RegExp(`/w/${b.slug}/?$`));await other.unroute(`**/api/reporter/w/${a.slug}/workspace`);await other.goto(`/w/${a.slug}/productions`);expect(otherErrors).toEqual([]);
      const account=page.getByRole('button',{name:/Menu da conta$/});
      if(width===390){const opener=page.getByRole('button',{name:'Abrir menu',exact:true});if(await opener.getAttribute('aria-expanded')!=='true')await opener.click();}
      await account.click();await page.getByRole('menuitem',{name:'Administrar workspace',exact:true}).click();
      await expect(page).toHaveURL(new RegExp(`/w/${b.slug}/admin/workspace$`));
      const publication=page.getByRole('textbox',{name:'Nome do veículo',exact:true});await publication.fill(`Unsaved brand ${suffix}`);
      await (await choice(a)).click();
      const formWarning=page.getByRole('dialog',{name:'Sair sem salvar?',exact:true});await expect(formWarning).toBeVisible();
      await formWarning.getByRole('button',{name:'Continuar editando',exact:true}).click();await expect(publication).toHaveValue(`Unsaved brand ${suffix}`);
      await (await choice(a)).click();await formWarning.getByRole('button',{name:'Descartar e sair',exact:true}).click();
      await expect(page.locator('[data-part="switcher"]')).toHaveAttribute('aria-label',new RegExp(a.name));
      const latest=await(await request.get(`/api/reporter/platform/workspaces/${b.id}`,{headers})).json();
      const archived=await request.post(`/api/reporter/platform/workspaces/${b.id}/update`,{headers,data:{name:b.name,status:'archived',revision:latest.revision}});expect(archived.ok()).toBe(true);
      const paths:string[]=[];page.on('request',request=>{if(request.url().includes('/api/reporter/'))paths.push(new URL(request.url()).pathname);});
      await page.goto(`/w/${b.slug}/`);await expect(page.getByRole('heading',{name:'Escolher workspace',exact:true})).toBeVisible();
      await page.getByRole('searchbox',{name:'Buscar workspace',exact:true}).fill(b.name);
      await expect(page.getByRole('link',{name:new RegExp(b.name)})).toHaveAttribute('href',`/platform/workspaces/${b.id}`);
      await page.goto(`/w/missing-${suffix}/productions`);await expect(page.getByRole('heading',{name:'Escolher workspace',exact:true})).toBeVisible();
      expect(paths).not.toContain('/api/reporter/workspace');expect(paths.some(path=>path.startsWith('/api/reporter/w/reporter-ai/'))).toBe(false);
      await other.goto(`/w/${a.slug}/productions/${production.productionId}/article`);
      const otherEditor=other.getByRole('textbox',{name:'Texto do artigo',exact:true});await expect(otherEditor).toBeVisible();
      await otherEditor.click();await otherEditor.press('ControlOrMeta+End');await otherEditor.pressSequentially('Pending when account changes');
      await page.evaluate(()=>localStorage.setItem('reporter:account-revision',crypto.randomUUID()));
      await expect(other.locator('[data-part="switcher"]')).toHaveAttribute('aria-label',new RegExp(a.name));
      await expect(other).toHaveURL(new RegExp(`/w/${a.slug}/?$`));
      expect(dialogs).toEqual([]);expect(otherErrors).toEqual([]);await other.close();expect(errors).toEqual([]);
    });
  });
}
