import { spawnSync } from 'node:child_process';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { waitForWorkerSchedule } from './check-worker-schedule.mjs';

if(!process.env.GITHUB_ACTIONS || !process.env.GITHUB_ACTOR) throw new Error('Neon acceptance deployments must originate from the authenticated GitHub workflow.');
for(const name of ['NEON_PROJECT_ID','NEON_BRANCH_ID','NEON_API_KEY','REPORTER_WORKER_PASSWORD','GROQ_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY','PIXABAY_API_KEY'])if(!process.env[name])throw new Error(`Missing ${name} for Neon acceptance.`);
const project=process.env.NEON_PROJECT_ID,parent=process.env.NEON_BRANCH_ID;
const directory=await mkdtemp(join(tmpdir(),'reporter-neon-acceptance-')),file=join(directory,'runtime.env');
let branch,runtimePassword,keepBranch=false;
const cliEnvironment={...process.env};
async function api(path,method='GET',body){const r=await fetch(`https://console.neon.tech/api/v2/projects/${project}/${path}`,{method,headers:{Authorization:`Bearer ${process.env.NEON_API_KEY}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw new Error(`Neon acceptance API failed (${r.status}).`);return r.status===204?{}:r.json();}
function cli(args,quiet=false){const result=spawnSync('neon',args,{encoding:'utf8',env:cliEnvironment,stdio:quiet?'pipe':'inherit',maxBuffer:4e6});if(result.status!==0)throw new Error('Neon acceptance command failed.');return result.stdout?.trim();}
async function appendSettings(){const values={
  REPORTER_DEPLOYMENT_MODE:'cloud',REPORTER_DEFAULT_PORTAL_ID:'10000000-0000-0000-0000-000000000101',
  REPORTER_WORKER_PASSWORD:process.env.REPORTER_WORKER_PASSWORD,REPORTER_RUNTIME_PASSWORD:runtimePassword,
  GROQ_API_KEY:process.env.GROQ_API_KEY,OPENAI_API_KEY:process.env.OPENAI_API_KEY,ANTHROPIC_API_KEY:process.env.ANTHROPIC_API_KEY,PIXABAY_API_KEY:process.env.PIXABAY_API_KEY,
};const {appendFile}=await import('node:fs/promises');await appendFile(file,'\n'+Object.entries(values).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n',{mode:0o600});}
try {
  const created=await api('branches','POST',{branch:{parent_id:parent,name:`acceptance-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`,expires_at:new Date(Date.now()+86400000).toISOString()},endpoints:[{type:'read_write'}]});
  branch=created.branch.id;console.log(`Created isolated Neon acceptance branch ${branch}.`);
  const owner=cli(['connection-string',branch,'--project-id',project,'--role-name','neondb_owner'],true);
  cliEnvironment.DATABASE_URL=owner;
  const runtimeManaged=new URL(cli(['connection-string',branch,'--project-id',project,'--role-name','reporter_runtime'],true));runtimePassword=decodeURIComponent(runtimeManaged.password);
  cli(['env','pull','--project-id',project,'--branch',branch,'--file',file]);await appendSettings();
  const runtime=new URL(owner),worker=new URL(owner);runtime.username='reporter_runtime';runtime.password=runtimePassword;worker.username='reporter_worker';worker.password=process.env.REPORTER_WORKER_PASSWORD;
  const {appendFile}=await import('node:fs/promises');await appendFile(file,`DATABASE_URL=${JSON.stringify(owner)}\nDATABASE_URL_UNPOOLED=${JSON.stringify(owner)}\nREPORTER_DATABASE_URL=${JSON.stringify(runtime.toString())}\nREPORTER_WORKER_DATABASE_URL=${JSON.stringify(worker.toString())}\n`);
  for(const args of [['--env-file='+file,'scripts/reporter-cloud.mjs','migrate']]){const r=spawnSync(process.execPath,args,{stdio:'inherit'});if(r.status!==0)throw new Error('Acceptance migrations failed.');}
  const url=new URL(owner);url.searchParams.set('sslmode','verify-full');const db=new pg.Client({connectionString:url.toString()});await db.connect();
  const pipelinePath=join(directory,'pipeline.json');
  try {
    const stored=(await db.query("SELECT checkpoint->'pipeline'->'definition' AS definition FROM public.reporter_editorial_workspaces WHERE portal_id='10000000-0000-0000-0000-000000000101'")).rows[0]?.definition;
    await writeFile(pipelinePath,JSON.stringify(stored??null),{mode:0o600});
    await db.query('DELETE FROM public.reporter_worker_heartbeats');await db.query('DELETE FROM public.reporter_editorial_workspaces');
  }finally{await db.end();}
  cli(['deploy','--project-id',project,'--branch',branch,'--env',file,'--no-env-pull']);
  cli(['env','pull','--project-id',project,'--branch',branch,'--file',join(directory,'deployed.env')]);
  const {parseEnv}=await import('node:util'),{readFile}=await import('node:fs/promises');const deployed=parseEnv(await readFile(join(directory,'deployed.env'),'utf8'));
  await appendFile(file,Object.entries(deployed).filter(([name])=>name.startsWith('AWS_')||name.startsWith('NEON_FUNCTION_')).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n');
  const provision=spawnSync(process.execPath,['--env-file='+file,'scripts/provision-worker-media.mjs'],{stdio:'inherit'});if(provision.status!==0)throw new Error('Acceptance media provisioning failed.');
  const endpoint=deployed.NEON_FUNCTION_REPORTERWORKER_BASE_URL;if(!endpoint)throw new Error('Acceptance function URL missing.');
  keepBranch=process.env.REPORTER_ACCEPTANCE_SESSION==='true';
  if(keepBranch)console.log(`Isolated acceptance session: ${branch}; source ${process.env.GITHUB_SHA}. Expires in 24 hours.`);
  const health=await fetch(endpoint,{headers:{'x-reporter-worker-key':process.env.REPORTER_WORKER_PASSWORD},signal:AbortSignal.timeout(180000)});const ready=await health.json();
  if(!health.ok||ready.ok!==true)throw new Error('Acceptance worker readiness failed: '+String(ready.error??health.status));
  const schedule=new pg.Client({connectionString:url.toString()});await schedule.connect();
  try{await waitForWorkerSchedule((...args)=>schedule.query(...args),new URL(endpoint).origin);}finally{await schedule.end();}
  console.log('PASS deployed worker media, database, storage and real scheduled invocation.');
  if(keepBranch){
    console.log(`READY real-file acceptance session ${branch}. No production deployment was performed.`);
  }else{
  const flow=spawnSync(process.execPath,['--env-file='+file,'--conditions=react-server','--import','tsx','scripts/neon-flow-acceptance.mjs'],{stdio:'inherit',env:{...process.env,REPORTER_ACCEPTANCE_BRANCH:branch,REPORTER_ACCEPTANCE_PIPELINE_PATH:pipelinePath}});
  if(flow.status!==0)throw new Error('Full Neon flow acceptance failed.');
  console.log(`PASS full Neon acceptance for ${process.env.GITHUB_SHA}.`);
  }
} finally {
  if(branch&&!keepBranch){await api('branches/'+branch,'DELETE');console.log('Removed isolated acceptance branch.');}
  await rm(directory,{recursive:true,force:true});
}
