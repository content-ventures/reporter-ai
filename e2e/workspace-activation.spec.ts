import {expect,test} from '@playwright/test';
import {expectHeadingOutline,expectNoHorizontalOverflow,watchErrors} from './support';
const LABELS={off:'Pausada',admin:'Administração da plataforma',all:'Equipes dos clientes'};
test.describe.configure({mode:'serial'});
for(const width of [1440,390]){
  test.describe(`workspace activation at ${width}`,()=>{
    test.use({viewport:{width,height:1000},...(width===390?{isMobile:true,hasTouch:true}:{})});
    test('changes availability in the console and refuses a stale draft without changing the pilot',async({page,request,baseURL})=>{
      test.skip(process.env.REPORTER_WORKSPACES_MODE!=='all','requires the isolated workspace rollout');
      const headers={origin:baseURL!,'x-reporter-client':'local'},errors=watchErrors(page,[/409.*\/workspace-activation/]);
      const path='/api/reporter/platform/workspace-activation',read=async()=> (await request.get(path,{headers})).json();
      const before=await(await request.get('/api/reporter/pipeline',{headers})).json();
      try{
        await page.goto('/platform/workspaces');await page.getByRole('button',{name:'Navegação',exact:true}).click();
        const drawer=page.getByRole('dialog',{name:'Navegação dos workspaces',exact:true}),choice=drawer.getByRole('combobox',{name:'Disponibilidade da navegação',exact:true});
        await expect(choice).toBeEnabled();
        const initial=await read(),target=initial.mode==='all'?'admin':'all';
        async function select(mode:'admin'|'all'){
          await choice.click();await expect(choice).toHaveAttribute('aria-expanded','true');
          await page.getByRole('option',{name:LABELS[mode],exact:true}).click();await expect(choice).toContainText(LABELS[mode]);
        }
        await select(target);await drawer.getByRole('button',{name:'Salvar disponibilidade',exact:true}).click();
        await expect(page.getByText('Disponibilidade atualizada',{exact:true})).toBeVisible();
        expect((await read()).mode).toBe(target);
        await page.screenshot({path:`.reporter-local/multi-workspace/m8-activation-${width}.png`,animations:'disabled'});
        await expectHeadingOutline(page);await expectNoHorizontalOverflow(page);
        const current=await read(),draft=target==='all'?'admin':'all';await select(draft);
        expect((await request.post(path,{headers,data:{mode:draft,revision:current.revision}})).ok()).toBe(true);
        await drawer.getByRole('button',{name:'Salvar disponibilidade',exact:true}).click();
        await expect(drawer.getByText('A disponibilidade mudou em outra sessão. Recarregue antes de salvar.',{exact:true})).toBeVisible();
        await expect(choice).toContainText(LABELS[draft]);
        await drawer.getByRole('button',{name:'Recarregar disponibilidade',exact:true}).click();
        await expect(drawer.getByRole('button',{name:'Salvar disponibilidade',exact:true})).toBeDisabled();
        if(draft!=='all'){await select('all');await drawer.getByRole('button',{name:'Salvar disponibilidade',exact:true}).click();}
        await expect.poll(async()=> (await read()).mode).toBe('all');
        await drawer.getByRole('button',{name:'Fechar',exact:true}).click();
        expect(await(await request.get('/api/reporter/pipeline',{headers})).json()).toEqual(before);
        expect(errors).toEqual([]);
      }finally{
        const state=await read();if(state.mode!=='all')await request.post(path,{headers,data:{mode:'all',revision:state.revision}});
      }
    });
  });
}
