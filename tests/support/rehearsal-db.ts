import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const root = new URL('../../', import.meta.url);
const context = process.env.CI ? 'default' : 'desktop-linux';

function docker(args: string[]) {
  const env = { ...process.env };
  delete env.DOCKER_HOST; delete env.DOCKER_CONTEXT;
  const result = spawnSync('docker', ['--context', context, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'Docker command failed');
  return result.stdout.trim();
}

function script(args: string[], env: Record<string, string>) {
  // The production migrator and grant command, pointed at the disposable database.
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(`${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

/**
 * A disposable PostgreSQL on loopback with the complete cloud schema, applied by the same
 * migrator as Neon. Its data lives in tmpfs and the container is removed on stop.
 */
export async function startRehearsalDatabase(users: { email: string; role: string }[], options: { beforeMigration?: string;activation?:'off'|'admin'|'all' } = {}) {
  const configuration = await readFile(new URL('compose.reporter.yaml', root), 'utf8');
  const image = configuration.match(/^    image: (postgres:17\.9@sha256:[a-f0-9]{64})$/m)?.[1];
  if (!image) throw new Error('Pinned PostgreSQL image not found');
  const password = randomBytes(18).toString('base64url');
  const id = docker(['run', '--detach', '--rm', '--label', 'reporter-ai.verification=rehearsal',
    '--tmpfs', '/var/lib/postgresql/data:rw', '-p', '127.0.0.1::5432',
    '-e', 'POSTGRES_DB=reporter_cloud', '-e', 'POSTGRES_USER=reporter_owner', '-e', `POSTGRES_PASSWORD=${password}`, image]);
  try {
    const port = docker(['port', id, '5432/tcp']).split('\n')[0].split(':').at(-1);
    const owner = `postgresql://reporter_owner:${password}@127.0.0.1:${port}/reporter_cloud`;
    for (let attempt = 0; ; attempt++) {
      const client = new pg.Client({ connectionString: owner });
      try { await client.connect(); await client.query('SELECT 1'); break; }
      catch (error) { if (attempt > 60) throw error; await delay(500); }
      finally { await client.end().catch(() => {}); }
    }
    const migrate = () => script(['scripts/reporter-cloud.mjs', 'migrate'], { DATABASE_URL: owner });
    if (options.beforeMigration) {
      const { CLOUD } = await import('../../scripts/lib/migrations.mjs');
      const cutoff = CLOUD.indexOf(options.beforeMigration);
      if (cutoff < 3) throw new Error('The rehearsal cutoff must name a registered additive migration');
      const baseline = new pg.Client({ connectionString: owner });
      await baseline.connect();
      try {
        for (const path of CLOUD.slice(0, cutoff)) await baseline.query(await readFile(new URL(path, root), 'utf8'));
      } finally { await baseline.end(); }
    } else migrate();
    const runtimePassword = randomBytes(24).toString('base64url'), workerPassword = randomBytes(24).toString('base64url');
    const admin = new pg.Client({ connectionString: owner });
    await admin.connect();
    try {
      await admin.query(`ALTER ROLE reporter_runtime LOGIN PASSWORD '${runtimePassword}'`);
      await admin.query(`ALTER ROLE reporter_worker LOGIN PASSWORD '${workerPassword}'`);
      await admin.query('GRANT CONNECT ON DATABASE reporter_cloud TO reporter_runtime,reporter_worker');
      if((await admin.query("SELECT to_regclass('public.reporter_workspace_activation') AS table")).rows[0].table)
        await admin.query('UPDATE public.reporter_workspace_activation SET mode=$1',[options.activation??'all']);
    } finally { await admin.end(); }
    for (const user of users) script(['scripts/reporter-cloud.mjs', 'grant', '--email', user.email, '--role', user.role], { DATABASE_URL: owner });
    const role = (name: string, secret: string) => `postgresql://reporter_${name}:${secret}@127.0.0.1:${port}/reporter_cloud`;
    return { owner, runtime: role('runtime', runtimePassword), worker: role('worker', workerPassword), workerPassword, migrate,
      stop: () => { docker(['stop', '--time', '2', id]); } };
  } catch (error) { docker(['stop', '--time', '2', id]); throw error; }
}
