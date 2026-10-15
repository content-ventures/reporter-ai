import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import nextEnv from '@next/env';
import pg from 'pg';
import { CLOUD, CLOUD_BASE_FILES } from './lib/migrations.mjs';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
const { Client } = pg;
const command = process.argv[2] ?? 'status';
const files = CLOUD;

function ownerUrl() {
  const value = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
  if (!value) throw new Error('DATABASE_URL_UNPOOLED is required');
  const url = new URL(value);
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') throw new Error('Expected a PostgreSQL URL');
  // Neon requires verified TLS; only a loopback rehearsal database may connect without it.
  if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) url.searchParams.set('sslmode','verify-full');
  return url;
}

async function connect() {
  const client = new Client({ connectionString: ownerUrl().toString(),application_name: 'reporter-ai-cloud-maintenance' });
  await client.connect();
  return client;
}

async function status(client) {
  const core = (await client.query("SELECT to_regnamespace('core') IS NOT NULL AS ready")).rows[0].ready;
  if (!core) return { database: (await client.query('SELECT current_database() AS database')).rows[0].database,schemaReady: false,cloudReady: false,boundUsers: 0 };
  const { rows } = await client.query(`SELECT current_database() AS database,
    to_regclass('public.reporter_ed_sync') IS NOT NULL AS schema_ready,
    obj_description(to_regprocedure('public.reporter_session_context(text,text,text,text,boolean,uuid)'),'pg_proc') AS cloud_marker,
    (SELECT count(*)::int FROM core.users WHERE auth_subject IS NOT NULL) AS bound_users`);
  return { database: rows[0].database,schemaReady: rows[0].schema_ready,cloudReady: rows[0].cloud_marker === 'reporter-neon-cloud-v2',boundUsers: rows[0].bound_users };
}

async function migrate(client) {
  const core = (await client.query("SELECT to_regnamespace('core') IS NOT NULL AS ready")).rows[0].ready;
  const r1 = core && (await client.query("SELECT to_regclass('public.reporter_transcripts') IS NOT NULL AS ready")).rows[0].ready;
  const selected = !core ? files : !r1 ? files.slice(1) : files.slice(CLOUD_BASE_FILES);
  let executorMembershipBefore;
  let ownerRoleName;
  let migrationError;
  const allowOwnershipTransfer = async () => {
    const membership = (await client.query("SELECT current_user AS name,pg_has_role(current_user,'reporter_executor','MEMBER') AS member,pg_has_role(current_user,'reporter_executor','SET') AS can_set")).rows[0];
    if (!/^[a-zA-Z_][a-zA-Z0-9_$]*$/.test(membership.name)) throw new Error('Unsafe database role name');
    ownerRoleName = membership.name;
    executorMembershipBefore ??= { member: membership.member,canSet: membership.can_set };
    if (!membership.can_set) await client.query(`GRANT reporter_executor TO "${membership.name}" WITH SET TRUE`);
  };
  try {
    if (core) {
      await client.query(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='reporter_executor') THEN
        CREATE ROLE reporter_executor NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;END IF;END $$`);
      await allowOwnershipTransfer();
    }
    for (const file of selected) {
      process.stdout.write(`Applying ${file}... `);
      await client.query(await readFile(resolve(file),'utf8'));
      console.log('ok');
      if (file.endsWith('reporter-foundation.sql')) {
        await client.query(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='reporter_executor') THEN
          CREATE ROLE reporter_executor NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;END IF;END $$`);
        await allowOwnershipTransfer();
      }
    }
  } catch (error) {
    migrationError = error;
    await client.query('ROLLBACK').catch(() => {});
  } finally {
    if (executorMembershipBefore && ownerRoleName) {
      if (!executorMembershipBefore.member) await client.query(`REVOKE reporter_executor FROM "${ownerRoleName}"`);
      else if (!executorMembershipBefore.canSet) await client.query(`REVOKE SET OPTION FOR reporter_executor FROM "${ownerRoleName}"`);
    }
  }
  if (migrationError) throw migrationError;
  return status(client);
}

function roleUrl(owner,role,password) {
  const url = new URL(owner);
  url.username = role;url.password = password;
  return url.toString();
}

async function configureRoles(client) {
  const runtimePassword = randomBytes(32).toString('base64url');
  const workerPassword = randomBytes(32).toString('base64url');
  await client.query("SELECT set_config('reporter.runtime_password',$1,false),set_config('reporter.worker_password',$2,false)",[runtimePassword,workerPassword]);
  await client.query(`DO $$ BEGIN
    EXECUTE format('ALTER ROLE reporter_runtime LOGIN PASSWORD %L',current_setting('reporter.runtime_password'));
    EXECUTE format('ALTER ROLE reporter_worker LOGIN PASSWORD %L',current_setting('reporter.worker_password'));
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO reporter_runtime,reporter_worker',current_database());
  END $$`);
  const owner = ownerUrl();
  const values = {
    REPORTER_DEFAULT_PORTAL_ID: '10000000-0000-0000-0000-000000000101',
    REPORTER_RUNTIME_PASSWORD: runtimePassword,
    REPORTER_WORKER_PASSWORD: workerPassword,
    REPORTER_DATABASE_URL: roleUrl(owner,'reporter_runtime',runtimePassword),
    REPORTER_WORKER_DATABASE_URL: roleUrl(owner,'reporter_worker',workerPassword),
  };
  for (const file of ['.env.local','.env.development.local']) {
    let source = await readFile(file,'utf8').catch(() => '');
    for (const [name,value] of Object.entries(values)) {
      const line = `${name}=${value}`;
      const pattern = new RegExp(`^${name}=.*$`,'m');
      source = pattern.test(source) ? source.replace(pattern,line) : `${source.trimEnd()}\n${line}\n`;
    }
    await writeFile(file,source,{ mode: 0o600 });
  }
  console.log('Cloud runtime and worker roles configured in ignored local env files.');
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index+1] : undefined;
}

async function grant(client) {
  const email = option('email')?.trim().toLowerCase();
  const name = option('name')?.trim() || email;
  const role = option('role')?.trim() || 'admin';
  const tenantRole = role === 'admin' ? 'admin' : 'member';
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Use --email usuario@dominio');
  if (!['admin','editor','approver','creative_reviewer'].includes(role)) throw new Error('Invalid --role');
  await client.query('BEGIN');
  try {
    const user = (await client.query(`INSERT INTO core.users(name,email) VALUES($1,$2)
      ON CONFLICT(email) DO UPDATE SET name=excluded.name,updated_at=clock_timestamp() RETURNING id`,[name,email])).rows[0];
    await client.query(`INSERT INTO core.tenant_members(tenant_id,user_id,role) VALUES('10000000-0000-0000-0000-000000000001',$1,$2)
      ON CONFLICT(tenant_id,user_id) DO UPDATE SET role=excluded.role,status='active'`,[user.id,tenantRole]);
    await client.query(`INSERT INTO public.portal_members(tenant_id,portal_id,user_id,status) VALUES('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000101',$1,'active') ON CONFLICT(portal_id,user_id) DO UPDATE SET status='active'`,[user.id]);
    await client.query(`DELETE FROM public.portal_user_roles WHERE portal_id='10000000-0000-0000-0000-000000000101' AND user_id=$1`,[user.id]);
    await client.query(`INSERT INTO public.portal_user_roles(portal_id,user_id,portal_role_id)
      SELECT '10000000-0000-0000-0000-000000000101',$1,id FROM public.portal_roles
      WHERE portal_id='10000000-0000-0000-0000-000000000101' AND name=$2 ON CONFLICT DO NOTHING`,[user.id,role]);
    await client.query('COMMIT');
    console.log(`Access granted to ${email} as ${role}. The Auth subject binds after verified sign-in.`);
  } catch (error) { await client.query('ROLLBACK');throw error; }
}

const client = await connect();
try {
  if (command === 'migrate') console.log(JSON.stringify(await migrate(client),null,2));
  else if (command === 'roles') await configureRoles(client);
  else if (command === 'grant') await grant(client);
  else if (command === 'status') console.log(JSON.stringify(await status(client),null,2));
  else throw new Error('Use: status | migrate | roles | grant --email ... [--name ...] [--role ...]');
} finally { await client.end(); }
