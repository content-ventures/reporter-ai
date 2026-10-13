import nextEnv from '@next/env';
import pg from 'pg';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
const { Client } = pg;
const portal = process.env.REPORTER_DEFAULT_PORTAL_ID || '10000000-0000-0000-0000-000000000101';

function connection(role) {
  const template = process.env.DATABASE_URL?.trim();
  const password = process.env[role === 'runtime' ? 'REPORTER_RUNTIME_PASSWORD' : 'REPORTER_WORKER_PASSWORD']?.trim();
  if (!template || !password) throw new Error('Cloud role configuration missing');
  const url = new URL(template);
  url.username = `reporter_${role}`;url.password = password;url.searchParams.set('sslmode','verify-full');
  return url.toString();
}

async function withClient(url,operation) {
  const client = new Client({ connectionString: url,application_name: 'reporter-ai-cloud-smoke' });
  await client.connect();
  try { return await operation(client); } finally { await client.end(); }
}

const runtime = await withClient(connection('runtime'),async client => {
  const user = (await client.query('SELECT current_user AS value')).rows[0].value;
  const deniedIdentity = (await client.query('SELECT * FROM public.reporter_session_context($1,$2,$3,$4,$5,$6)',[
    'smoke-unbound','smoke@example.invalid','Smoke',null,false,portal,
  ])).rowCount === 0;
  let directReadDenied = false;
  try { await client.query('SELECT id FROM core.users LIMIT 1'); }
  catch (error) { directReadDenied = error?.code === '42501'; }
  return { user,deniedIdentity,directReadDenied };
});

const worker = await withClient(connection('worker'),async client => {
  await client.query('BEGIN');
  try {
    await client.query("SELECT set_config('app.access_mode','job',true),set_config('app.job_key','reporter-ai-processing',true),set_config('app.portal_id',$1,true)",[portal]);
    await client.query("SELECT public.reporter_worker_heartbeat('cloud-smoke')");
    return { user: (await client.query('SELECT current_user AS value')).rows[0].value,heartbeat: true };
  } finally { await client.query('ROLLBACK'); }
});

const ownerUrl = new URL(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
ownerUrl.searchParams.set('sslmode','verify-full');
const owner = await withClient(ownerUrl.toString(),async client => ({
  executorSetRestored: !(await client.query("SELECT pg_has_role(current_user,'reporter_executor','SET') AS value")).rows[0].value,
  marker: (await client.query("SELECT obj_description(to_regprocedure('public.reporter_session_context(text,text,text,text,boolean,uuid)'),'pg_proc') AS value")).rows[0].value,
}));

const ok = runtime.user === 'reporter_runtime' && runtime.deniedIdentity && runtime.directReadDenied
  && worker.user === 'reporter_worker' && worker.heartbeat && owner.executorSetRestored && owner.marker === 'reporter-neon-cloud-v2';
console.log(JSON.stringify({ ok,runtime,worker,owner },null,2));
if (!ok) process.exitCode = 1;
