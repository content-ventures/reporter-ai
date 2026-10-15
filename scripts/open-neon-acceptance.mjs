import { execFileSync } from 'node:child_process';
import { appendFile,mkdtemp,writeFile,chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { activePipelineDefinition } from './lib/editorial-rows.mjs';

const branchId=process.argv[2],project=process.env.NEON_PROJECT_ID,parent=process.env.NEON_BRANCH_ID;
if(!branchId?.startsWith('br-')||branchId===parent||!project||!parent||!process.env.NEON_API_KEY)throw new Error('Provide an isolated acceptance branch and the production project identifiers.');
const response=await fetch(`https://console.neon.tech/api/v2/projects/${project}/branches/${branchId}`,{headers:{Authorization:`Bearer ${process.env.NEON_API_KEY}`}});
if(!response.ok)throw new Error('Cannot verify acceptance branch.');
const {branch}=await response.json();
if(!branch.name.startsWith('acceptance-')||branch.parent_id!==parent||!branch.expires_at)throw new Error('Only an expiring workflow-created acceptance branch is allowed.');
const cli=process.env.REPORTER_NEON_CLI??'neon',environment={...process.env};
function neon(args){return execFileSync(cli,args,{encoding:'utf8',env:environment,stdio:['ignore','pipe','pipe'],maxBuffer:4e6}).trim();}
const connection=role=>neon(['connection-string',branchId,'--project-id',project,'--role-name',role]);
const owner=connection('neondb_owner');environment.DATABASE_URL=owner;
const runtime=connection('reporter_runtime'),worker=new URL(owner);worker.username='reporter_worker';worker.password=process.env.REPORTER_WORKER_PASSWORD;
const directory=await mkdtemp(join(tmpdir(),'reporter-neon-session-')),file=join(directory,'runtime.env');
neon(['env','pull','--project-id',project,'--branch',branchId,'--file',file]);
const pipelinePath=join(directory,'pipeline.json');
const production=neon(['connection-string',parent,'--project-id',project,'--role-name','neondb_owner']);
const url=new URL(production);url.searchParams.set('sslmode','verify-full');const db=new pg.Client({connectionString:url.toString()});
try{await db.connect();await db.query('BEGIN READ ONLY');await writeFile(pipelinePath,JSON.stringify(await activePipelineDefinition(db,'10000000-0000-0000-0000-000000000101')),{mode:0o600});await db.query('ROLLBACK');}finally{await db.end();}
const values={NEON_PROJECT_ID:project,NEON_BRANCH_ID:parent,NEON_API_KEY:process.env.NEON_API_KEY,
  DATABASE_URL:owner,DATABASE_URL_UNPOOLED:owner,REPORTER_DATABASE_URL:runtime,REPORTER_WORKER_DATABASE_URL:worker.toString(),
  REPORTER_WORKER_PASSWORD:process.env.REPORTER_WORKER_PASSWORD,REPORTER_DEPLOYMENT_MODE:'cloud',REPORTER_ACCEPTANCE_BRANCH:branchId,
  REPORTER_DEFAULT_PORTAL_ID:'10000000-0000-0000-0000-000000000101',REPORTER_ACCEPTANCE_PIPELINE_PATH:pipelinePath,
  NEON_AUTH_COOKIE_SECRET:randomBytes(32).toString('hex'),GROQ_API_KEY:process.env.GROQ_API_KEY,
  OPENAI_API_KEY:process.env.OPENAI_API_KEY??process.env.OPEN_AI_API_KEY,ANTHROPIC_API_KEY:process.env.ANTHROPIC_API_KEY??process.env.CLAUDE_API_KEY,PIXABAY_API_KEY:process.env.PIXABAY_API_KEY};
await appendFile(file,'\n'+Object.entries(values).filter(([,v])=>v!==undefined).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n');
await chmod(file,0o600);console.log(`Private acceptance environment: ${file}`);
