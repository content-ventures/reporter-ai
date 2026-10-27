import {randomUUID} from 'node:crypto';
import {expect,test} from '@playwright/test';
import sharp from 'sharp';
import {expectHeadingOutline,expectNoHorizontalOverflow,watchErrors} from './support';

for(const width of [1440,390]){
  test.describe(`workspace administration at ${width}`,()=>{
    test.use({viewport:{width,height:1000},...(width===390?{isMobile:true,hasTouch:true}:{})});
    test('onboards a client through setup, independent invitations and readiness without touching the pilot',async({page,browser,request,baseURL})=>{
      test.skip(process.env.REPORTER_WORKSPACES_MODE!=='all','uses the isolated workspace rollout');
      test.setTimeout(90000);
      const errors=watchErrors(page,[/409.*\/processing/]),suffix=randomUUID().slice(0,8),name=`Acceptance client ${suffix}`,slug=`acceptance-${suffix}`;
      const headers={origin:baseURL!,'x-reporter-client':'local'};
      const pilotBefore=await(await request.get('/api/reporter/pipeline',{headers})).json();
      await page.goto('/platform/workspaces');
      await page.getByRole('button',{name:'Criar workspace',exact:true}).click();
      const creation=page.getByRole('dialog',{name:'Criar workspace',exact:true});
      await creation.getByRole('textbox',{name:'Cliente',exact:true}).fill(name);
      await creation.getByRole('textbox',{name:'Endereço',exact:true}).fill(slug);
      await creation.getByRole('button',{name:'Criar workspace',exact:true}).click();
      await expect(page).toHaveURL(/\/platform\/workspaces\/[a-f0-9-]+$/);
      const detail=page.url();await expect(page.getByRole('heading',{level:1,name,exact:true})).toBeVisible();
      await expect(page.getByRole('button',{name:'Ativar workspace',exact:true})).toBeDisabled();
      await expectHeadingOutline(page);await expectNoHorizontalOverflow(page);
      await page.getByRole('textbox',{name:'Nome do veículo',exact:true}).fill(`Publication ${suffix}`);
      const logo=await sharp({create:{width:24,height:24,channels:4,background:{r:40,g:100,b:160,alpha:1}}}).png().toBuffer();
      await page.locator('input[type=file]').setInputFiles({name:'client-brand.png',mimeType:'image/png',buffer:logo});
      await expect(page.getByText('Marca enviada. Salve os modelos para ativá-la.',{exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Salvar modelos e marca',exact:true}).click();
      await expect(page.getByText('Modelos e marca ativados para as próximas produções.',{exact:true})).toBeVisible();
      await page.goto(`/w/${slug}/settings/editorial-map`);
      await page.getByRole('textbox',{name:'Público',exact:true}).fill(`Retail buyers for ${suffix}`);
      await page.getByRole('button',{name:/^Salvar versão/}).click();
      await expect(page.getByText(/Mapa editorial v\d+ salvo/)).toBeVisible();
      await page.goto(`/w/${slug}/settings/writing-guide`);
      await page.getByRole('textbox',{name:'Voz',exact:true}).fill(`Specific and technical communication for ${suffix}`);
      await page.getByRole('button',{name:/^Salvar versão/}).click();
      await expect(page.getByText(/Guia de escrita v\d+ salvo/)).toBeVisible();
      await page.goto(detail);
      const inviteContext=await browser.newContext({baseURL,viewport:{width,height:1000}});
      try{
        for(const [label,role]of [['Editor','Editor'],['Reviewer','Aprovador']]as const){
          await page.getByRole('button',{name:'Convidar pessoa',exact:true}).click();
          const dialog=page.getByRole('dialog',{name:'Convidar pessoa',exact:true});
          await dialog.getByRole('textbox',{name:'Nome',exact:true}).click();
          await dialog.getByRole('textbox',{name:'Nome',exact:true}).fill(`${label} ${suffix}`);
          await dialog.getByRole('textbox',{name:'E-mail',exact:true}).fill(`${label.toLowerCase()}-${suffix}@acceptance.test`);
          if(role!=='Editor'){
            const choice=dialog.getByRole('combobox',{name:'Função neste workspace',exact:true});
            if(width===1440){
              await choice.focus();await choice.press('Enter');await expect(choice).toHaveAttribute('aria-expanded','true');
              await choice.press('ArrowDown');const target=page.getByRole('option',{name:new RegExp(`^${role}\\b`)});
              await expect(choice).toHaveAttribute('aria-activedescendant',(await target.getAttribute('id'))!);await choice.press('Enter');
            }
            else{await choice.click();await page.getByRole('option',{name:new RegExp(`^${role}\\b`)}).click();}
            await expect(choice).toContainText(role);
          }
          await dialog.getByRole('button',{name:'Criar convite',exact:true}).click();
          const issued=page.getByRole('dialog',{name:'Convite criado',exact:true});
          const link=await issued.getByRole('textbox',{name:'Link de acesso',exact:true}).inputValue();
          await issued.getByRole('button',{name:'Concluir',exact:true}).click();
          const acceptance=await inviteContext.newPage();await acceptance.goto(link);
          await acceptance.getByLabel('Senha',{exact:true}).fill('synthetic-acceptance-only');
          await acceptance.getByLabel('Confirme a senha',{exact:true}).fill('synthetic-acceptance-only');
          await acceptance.getByRole('button',{name:'Criar senha e entrar',exact:true}).click();
          await expect(acceptance).toHaveURL(/\/workspaces(?:\?entry=1)?$/);await expect(acceptance.getByRole('heading',{name:'Escolher workspace',exact:true})).toBeVisible();await acceptance.close();
        }
      }finally{await inviteContext.close().catch(()=>{});}
      await page.getByRole('button',{name:'Reavaliar configuração',exact:true}).click();
      await expect(page.getByRole('button',{name:'Ativar workspace',exact:true})).toBeEnabled();
      await page.getByRole('button',{name:'Ativar workspace',exact:true}).click();
      await expect(page.getByRole('button',{name:'Ativar workspace',exact:true})).toHaveCount(0);
      await expect(page.getByRole('table',{name:'Equipe do workspace'}).getByText(`Editor ${suffix}`,{exact:true})).toBeVisible();
      await expect(page.getByRole('table',{name:'Equipe do workspace'}).getByText(`Reviewer ${suffix}`,{exact:true})).toBeVisible();
      await page.getByRole('spinbutton',{name:'Limite diário de operações',exact:true}).fill('12');
      await page.getByRole('button',{name:'Salvar limite',exact:true}).click();
      await expect(page.getByText('Limite atualizado.',{exact:true})).toBeVisible();
      await page.reload();await expect(page.getByRole('spinbutton',{name:'Limite diário de operações',exact:true})).toHaveValue('12');
      const limit=page.getByRole('spinbutton',{name:'Limite diário de operações',exact:true}),id=new URL(detail).pathname.split('/').at(-1)!;
      await limit.fill('13');
      const current=await(await request.get(`/api/reporter/platform/workspaces/${id}/processing`,{headers})).json();
      expect((await request.post(`/api/reporter/platform/workspaces/${id}/processing`,{headers,data:{revision:current.revision,dailyLimit:14}})).ok()).toBeTruthy();
      await page.getByRole('button',{name:'Recarregar cadastro',exact:true}).click();
      await page.getByRole('textbox',{name:'Nome do cliente',exact:true}).fill(`${name} renamed`);
      await page.getByRole('button',{name:'Salvar nome',exact:true}).click();
      await expect(page.getByRole('heading',{level:1,name:`${name} renamed`,exact:true})).toBeVisible();
      await expect(limit,'a refreshed query must preserve an edited draft').toHaveValue('13');
      await page.getByRole('button',{name:'Salvar limite',exact:true}).click();
      await expect(page.getByText('O cadastro mudou em outra sessão. Atualize antes de salvar.',{exact:true})).toBeVisible();
      await expect(limit).toHaveValue('13');
      expect((await(await request.get(`/api/reporter/platform/workspaces/${id}/processing`,{headers})).json()).dailyLimit).toBe(14);
      await page.getByRole('button',{name:'Recarregar limite',exact:true}).click();await expect(limit).toHaveValue('14');
      await page.getByRole('button',{name:'Arquivar workspace',exact:true}).click();
      await page.getByRole('dialog',{name:'Arquivar workspace?',exact:true}).getByRole('button',{name:'Arquivar workspace',exact:true}).click();
      await expect(page.getByRole('button',{name:'Reativar workspace',exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Reativar workspace',exact:true}).click();
      await expect(page.getByRole('table',{name:'Equipe do workspace'}).getByText(`Editor ${suffix}`,{exact:true})).toBeVisible();
      await expect(page.getByRole('textbox',{name:'Nome do veículo',exact:true})).toHaveValue(`Publication ${suffix}`);
      await expect(limit).toHaveValue('14');
      await expectHeadingOutline(page);await expectNoHorizontalOverflow(page);
      await page.screenshot({path:`.reporter-local/multi-workspace/m5-client-${width}.png`,fullPage:true});
      const pilotAfter=await(await request.get('/api/reporter/pipeline',{headers})).json();
      expect(pilotAfter.active).toEqual(pilotBefore.active);
      expect(errors).toEqual([]);
    });
  });
}
