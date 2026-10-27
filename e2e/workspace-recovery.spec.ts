import {expect,test} from '@playwright/test';
import {expectNoHorizontalOverflow,watchErrors} from './support';

for(const width of [1440,390])test(`unavailable workspace addresses offer manual recovery at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const errors=watchErrors(page),reads:string[]=[];
  page.on('request',request=>{if(request.url().includes('/api/reporter/'))reads.push(new URL(request.url()).pathname);});
  const addresses=['/w/INVALID/productions','/w/reporter-ai/platform'];
  if(process.env.REPORTER_WORKSPACES_MODE==='off')addresses.push('/w/reporter-ai/productions');
  for(const address of addresses){
    await page.goto(address);await expect(page.getByRole('heading',{name:'Workspace indisponível',exact:true})).toBeVisible();
    const choice=page.getByRole('link',{name:'Escolher workspace',exact:true});await expect(choice).toHaveAttribute('href','/workspaces?unavailable=1');
    await expectNoHorizontalOverflow(page);await choice.click();
    await expect(page.getByRole('heading',{name:'Escolher workspace',exact:true})).toBeVisible();
    await expect(page).toHaveURL(/\/workspaces\?unavailable=1$/);
  }
  expect(reads).not.toContain('/api/reporter/workspace');expect(reads.some(path=>path.startsWith('/api/reporter/w/'))).toBe(false);expect(errors).toEqual([]);
});
