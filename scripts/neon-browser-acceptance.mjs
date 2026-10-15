import assert from 'node:assert/strict';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { writeFile,mkdir,readFile,stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import pg from 'pg';
import { chromium,expect } from '@playwright/test';
import { ATELIE_SUL_TRANSCRIPT } from '../src/fixtures/sources/atelie-sul.ts';

const branchId=process.env.REPORTER_ACCEPTANCE_BRANCH,project=process.env.NEON_PROJECT_ID,parent=process.env.NEON_BRANCH_ID;
assert.ok(branchId?.startsWith('br-')&&branchId!==parent);
const checked=await fetch(`https://console.neon.tech/api/v2/projects/${project}/branches/${branchId}`,{headers:{Authorization:`Bearer ${process.env.NEON_API_KEY}`}});
assert.equal(checked.ok,true);const {branch}=await checked.json();assert.ok(branch.name.startsWith('acceptance-')&&branch.parent_id===parent&&branch.expires_at);
const origin='https://reporter-ai-three.vercel.app',local=process.env.REPORTER_ACCEPTANCE_LOCAL_URL??'http://localhost:3001';
assert.ok(['localhost','127.0.0.1'].includes(new URL(local).hostname));
const portal='10000000-0000-0000-0000-000000000101',tenant='10000000-0000-0000-0000-000000000001';
const directory=process.env.REPORTER_ACCEPTANCE_EVIDENCE_DIR??join(tmpdir(),'reporter-browser-'+branchId);await mkdir(directory,{recursive:true,mode:0o700});
const dbUrl=new URL(process.env.DATABASE_URL_UNPOOLED);dbUrl.searchParams.set('sslmode','verify-full');
const db=new pg.Client({connectionString:dbUrl.toString()});await db.connect();

async function account(label,roles){
  const email=`acceptance-${randomUUID()}@example.invalid`,password=randomBytes(24).toString('base64url'),name='Acceptance '+label;
  const response=await fetch(process.env.NEON_AUTH_BASE_URL.replace(/\/$/,'')+'/sign-up/email',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({email,password,name})});
  const value=await response.json();assert.equal(response.ok,true,`Isolated signup failed (${response.status}, ${value.code??'unknown'})`);
  const subject=value.user?.id;assert.ok(subject);
  await db.query('UPDATE neon_auth."user" SET "emailVerified"=true WHERE id=$1 AND email=$2',[subject,email]);
  const actor=randomUUID();await db.query('INSERT INTO core.users(id,name,email,auth_subject,email_verified) VALUES($1,$2,$3,$4,true)',[actor,name,email,subject]);
  await db.query("INSERT INTO core.tenant_members(tenant_id,user_id,role) VALUES($1,$2,'member')",[tenant,actor]);
  await db.query("INSERT INTO public.portal_members(tenant_id,portal_id,user_id,status) VALUES($1,$2,$3,'active')",[tenant,portal,actor]);
  await db.query('INSERT INTO public.portal_user_roles(portal_id,user_id,portal_role_id) SELECT $1,$2,id FROM public.portal_roles WHERE portal_id=$1 AND name=ANY($3::text[])',[portal,actor,roles]);
  return {email,password,actor,name};
}

const browser=await chromium.launch({headless:true}),contexts=[];let activePage;
try{
  const editor=await account('Editor',['editor']),context=await browser.newContext({viewport:{width:1440,height:1000}});
  contexts.push(context);
  // This context serves the candidate production build through a loopback reverse proxy.
  // Every app-origin request is intercepted; no request reaches the production app.
  await context.route(origin+'/**',async route=>{
    try{
    const request=route.request(),url=new URL(request.url()),target=new URL(url.pathname+url.search,local);
    const headers=await request.allHeaders();headers.host=new URL(local).host;
    if(url.pathname.startsWith('/api/reporter')&&headers.origin)headers.origin=new URL(local).origin;
    const response=await route.fetch({url:target.toString(),headers,maxRedirects:0,timeout:240000});
    const resultHeaders=response.headers();if(resultHeaders.location?.startsWith(local))resultHeaders.location=resultHeaders.location.replace(local,origin);
    await route.fulfill({response,headers:resultHeaders});
    }catch{await route.abort().catch(()=>{});}
  });
  const page=await context.newPage(),errors=[];activePage=page;
  page.on('pageerror',error=>errors.push(error.name));
  page.on('response',response=>{if(response.url().includes('/api/reporter/')&&response.status()>=400)console.log('App API failure',new URL(response.url()).pathname,response.status());});
  await page.goto(origin+'/auth/sign-in');
  await page.getByRole('textbox',{name:'E-mail',exact:true}).fill(editor.email);
  await page.getByLabel('Senha',{exact:true}).fill(editor.password);
  await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Qual história vamos entregar hoje?'})).toBeVisible({timeout:60000});
  console.log('PASS actual Neon Auth login and isolated workspace authorization in browser.');
  const configured=JSON.parse(await readFile(process.env.REPORTER_ACCEPTANCE_PIPELINE_PATH,'utf8'));
  const pipelineHash=await page.evaluate(async({configured,requestId})=>{
    let settings=await (await fetch('/api/reporter/pipeline')).json();
    if(configured){
      const response=await fetch('/api/reporter/workspace',{method:'POST',headers:{'content-type':'application/json','x-reporter-client':'local'},body:JSON.stringify({method:'pipeline.save',args:[configured,settings.active.revision],requestId})});
      const result=await response.json();if(!response.ok||!result.ok)throw new Error('Cannot load the production pipeline in acceptance.');
      settings=await (await fetch('/api/reporter/pipeline')).json();
    }
    return settings.active.hash;
  },{configured,requestId:randomUUID()});
  console.log('PASS browser acceptance uses the configured production pipeline.');
  const results=[];
  const cases=process.env.REPORTER_ACCEPTANCE_BROWSER_CASES?.split(',')??['video','text','file'];
  for(const kind of cases){
    await page.goto(origin+'/productions/new');
    if(kind==='video'||kind==='file'){
      await page.getByRole('radio',{name:'Arquivo',exact:true}).click();
      const input=page.locator('input[type="file"]');
      if(kind==='video'){assert.ok(process.env.REPORTER_ACCEPTANCE_MEDIA_PATH);await input.setInputFiles(process.env.REPORTER_ACCEPTANCE_MEDIA_PATH);}
      else await input.setInputFiles({name:'acceptance-utf8.txt',mimeType:'text/plain',buffer:Buffer.from(ATELIE_SUL_TRANSCRIPT)});
    }else await page.getByRole('textbox',{name:'Transcrição',exact:true}).fill(ATELIE_SUL_TRANSCRIPT);
    await expect(page.getByRole('heading',{name:'Material (preenchida)',exact:true})).toBeVisible({timeout:30*60000});
    await page.getByRole('checkbox',{name:'Os falantes autorizaram o uso'}).check();
    while(await page.getByRole('button',{name:'Dispensar aviso',exact:true}).count())await page.getByRole('button',{name:'Dispensar aviso',exact:true}).first().click();
    await page.getByRole('button',{name:'Continuar',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'Título interno',exact:true})).toBeVisible({timeout:240000});
    await page.getByRole('textbox',{name:'Título interno',exact:true}).fill('Acceptance browser '+kind);
    await page.getByRole('button',{name:'Gerar artigo',exact:true}).click();
    await page.waitForURL(/\/productions\/[^/]+\/article$/,{timeout:60000});
    const productionId=new URL(page.url()).pathname.split('/')[2];console.log('Browser generation started',kind,productionId);
    await expect(page.getByRole('textbox',{name:'Texto do artigo'})).toBeVisible({timeout:15*60000});
    // The editor can show a preview before completion. Confirm the durable job settled.
    await expect.poll(async()=>{
      return page.evaluate(async id=>{
        const response=await fetch('/api/reporter/workspace');if(!response.ok)return false;const state=await response.json();
        const runs=Object.values(state.jobs).filter(job=>job.meta.productionId===id).map(job=>state.state.runFolds[job.meta.runId]?.run);
        const failed=runs.find(run=>run?.status==='failed');if(failed)throw new Error('GENERATION_FAILED: '+(failed.error?.code??'UNKNOWN'));
        return runs.some(run=>run?.status==='completed');
      },productionId);
    },{timeout:15*60000,intervals:[5000]}).toBe(true);
    await page.reload();await expect(page.getByRole('textbox',{name:'Texto do artigo'})).toBeVisible();
    const text=await page.getByRole('textbox',{name:'Texto do artigo'}).innerText();assert.ok(text.length>2000);
    await page.screenshot({path:join(directory,kind+'-article.png'),fullPage:true});
    let source;
    if(kind==='video'){
      const rows=(await db.query("SELECT id,key,size,status FROM core.storage_objects WHERE owner_user_id=$1 AND purpose='reporter-source' ORDER BY created_at DESC LIMIT 1",[editor.actor])).rows;
      assert.equal(rows.length,1);source=rows[0];
      const expected=await stat(process.env.REPORTER_ACCEPTANCE_MEDIA_PATH);assert.equal(Number(source.size),expected.size);assert.equal(source.status,'completed');
      const transcript=(await db.query('SELECT status,length(content) AS characters FROM public.reporter_transcripts WHERE source_object_id=$1',[source.id])).rows[0];
      assert.equal(transcript.status,'ready');assert.ok(transcript.characters>40);source.transcriptCharacters=transcript.characters;
      const hash=createHash('sha256');for await(const chunk of createReadStream(process.env.REPORTER_ACCEPTANCE_MEDIA_PATH))hash.update(chunk);source.sha256=hash.digest('hex');
    }
    results.push({kind,productionId,characters:text.length,...(source?{source}: {})});console.log('PASS browser source to completed article and reload',kind);
  }
  assert.deepEqual(errors,[],'Unexpected browser errors');
  await writeFile(join(directory,'results.json'),JSON.stringify({branch:branchId,commit:process.env.REPORTER_ACCEPTANCE_COMMIT,pipelineHash,results,passedAt:new Date().toISOString()},null,2),{mode:0o600});
  console.log('Browser acceptance evidence: '+join(directory,'results.json'));
}catch(error){await activePage?.screenshot({path:join(directory,'failure.png'),fullPage:true}).catch(()=>{});console.error('Browser acceptance failed: '+String(error.message).split('\n')[0].slice(0,180));process.exitCode=1;}
finally{await Promise.allSettled(contexts.map(context=>context.unrouteAll({behavior:'ignoreErrors'})));await browser.close();await db.end();}
