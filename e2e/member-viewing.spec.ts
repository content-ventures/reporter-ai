import {randomUUID} from 'node:crypto';
import {expect,test} from '@playwright/test';
import {expectHeadingOutline,expectLoaded,expectNoHorizontalOverflow,watchErrors} from './support';

for(const width of [1440,390]){
  test.describe(`member inspection at ${width}`,()=>{
    test.use({viewport:{width,height:1000},...(width===390?{isMobile:true,hasTouch:true}:{})});
    test('keeps the actual operator visible, refuses changes and clears the viewed context on exit and revocation',async({page,request,baseURL})=>{
      test.skip(process.env.REPORTER_WORKSPACES_MODE!=='all','requires the isolated workspace rollout');
      const suffix=randomUUID().slice(0,8),headers={origin:baseURL!,'x-reporter-client':'local'},name=`Viewed administrator ${suffix}`;
      const errors=watchErrors(page,[/410.*\/api\/reporter\//]);
      const creation=await request.post('/api/reporter/platform/workspaces',{headers,data:{name:`Inspection ${suffix}`,slug:`inspection-${suffix}`}});
      expect(creation.status()).toBe(201);const workspace=await creation.json();
      const issued=await request.post('/api/reporter/platform/invites',{headers,data:{workspaceId:workspace.id,name,email:`view-${suffix}@acceptance.test`,role:'admin'}});
      expect(issued.ok()).toBe(true);const invite=await issued.json(),person=invite.person.id;
      expect((await request.post(`/api/reporter/invites/${invite.token}/accept`,{headers,data:{password:'synthetic-view-acceptance',confirmation:'synthetic-view-acceptance'}})).ok()).toBe(true);
      const before=await(await request.get(`/api/reporter/w/${workspace.slug}/pipeline`,{headers})).json();
      await page.goto(`/platform/people?person=${person}`);
      const drawer=page.getByRole('dialog',{name,exact:true});
      await expect(drawer.getByRole('link',{name:'Uso desta pessoa',exact:true})).toHaveAttribute('href',new RegExp(`workspace=${workspace.id}&person=${person}`));
      await drawer.getByRole('button',{name:'Visualizar como usuário',exact:true}).click();
      await expect(page).toHaveURL(new RegExp(`/w/${workspace.slug}/?\\?view=[a-f0-9-]+$`));
      const id=new URL(page.url()).searchParams.get('view')!;
      await expect(page.getByText(`Visualizando ${name} · ${workspace.name}`,{exact:true})).toBeVisible();
      await expectLoaded(page);await expectHeadingOutline(page);await expectNoHorizontalOverflow(page);
      if(width===390)await page.getByRole('button',{name:'Abrir menu',exact:true}).click();
      const account=page.getByRole('button',{name:/Development operator.*Menu da conta$/});await expect(account).toBeVisible();
      await expect(page.getByRole('link',{name:'Produções',exact:true})).toHaveAttribute('href',`/w/${workspace.slug}/productions?view=${id}`);
      await account.click();await page.getByRole('menuitem',{name:'Consultar administração do workspace',exact:true}).click();
      await expect(page).toHaveURL(new RegExp(`/w/${workspace.slug}/admin/workspace\\?view=${id}$`));
      await expect(page.getByRole('textbox',{name:'Nome do veículo',exact:true})).toBeDisabled();
      await expect(page.getByRole('button',{name:'Salvar modelos e marca',exact:true})).toBeDisabled();
      await expect(page.getByRole('button',{name:'Convidar pessoa',exact:true})).toBeDisabled();
      await page.screenshot({path:`.reporter-local/multi-workspace/m7-inspection-${width}.png`,fullPage:true,animations:'disabled'});
      await expectHeadingOutline(page);await expectNoHorizontalOverflow(page);
      await page.goto(`/w/${workspace.slug}/config?tab=prompts&view=${id}`);
      await page.getByRole('button',{name:'Consultar Diretrizes gerais',exact:true}).click();
      const prompt=page.getByRole('dialog',{name:'Diretrizes gerais',exact:true});
      await expect(prompt.getByRole('textbox',{name:'Instruções do prompt',exact:true})).toBeDisabled();
      await expect(prompt.getByRole('button',{name:'Salvar e ativar tudo',exact:true})).toBeDisabled();
      await prompt.getByRole('button',{name:'Fechar consulta',exact:true}).click();
      await expect.poll(async()=>page.evaluate(async()=> (await indexedDB.databases()).map(db=>db.name))).toContain(`reporter-assets:${workspace.id}:00000000-0000-0000-0000-000000000031:view:${id}`);
      const mutation=await request.post(`/api/reporter/w/${workspace.slug}/workspace`,{headers:{...headers,'x-reporter-view':id},data:{method:'createBlank',args:[{}],requestId:randomUUID()}});
      expect(mutation.status()).toBe(403);
      await page.getByRole('button',{name:'Sair da visualização',exact:true}).click();
      await expect(page).toHaveURL(new RegExp(`/platform/people\\?person=${person}$`));
      expect((await request.get(`/api/reporter/w/${workspace.slug}/workspace`,{headers:{...headers,'x-reporter-view':id}})).status()).toBe(410);
      expect(await(await request.get(`/api/reporter/w/${workspace.slug}/pipeline`,{headers})).json()).toEqual(before);
      const again=await request.post('/api/reporter/platform/member-views',{headers,data:{workspaceId:workspace.id,personId:person}});expect(again.status()).toBe(201);
      const second=await again.json();await page.goto(`/w/${workspace.slug}/?view=${second.id}`);
      await expect(page.getByText(`Visualizando ${name} · ${workspace.name}`,{exact:true})).toBeVisible();
      const team=await(await request.get(`/api/reporter/platform/workspaces/${workspace.id}/team`,{headers})).json(),member=team.items.find((entry:{personId:string})=>entry.personId===person);
      expect((await request.post(`/api/reporter/platform/workspaces/${workspace.id}/members/${person}`,{headers,data:{revision:member.revision,status:'suspended'}})).ok()).toBe(true);
      await expect(page).toHaveURL(/\/workspaces\?viewing=ended$/);
      await expect(page.getByRole('heading',{name:'Escolher workspace',exact:true})).toBeVisible();
      expect(errors).toEqual([]);
    });
  });
}
