import { spawnSync } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { assertStagingTarget } from './lib/staging-target.mjs';

const PORTAL = '10000000-0000-0000-0000-000000000101';
const SECRETS = ['REPORTER_WORKER_PASSWORD', 'REPORTER_RUNTIME_PASSWORD', 'REPORTER_APP_ORIGINS', 'GROQ_API_KEY', 'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY', 'PIXABAY_API_KEY'];

/**
 * Writes a mode-0600 env file that runs the server code against staging: owner, runtime and
 * worker connections, the worker and storage deployed there, and the provider keys. The
 * staging worker must already be deployed by the release's staging stage.
 */
export async function writeStagingEnvironment(file, environment = process.env, { run = spawnSync, request = fetch } = {}) {
  await assertStagingTarget(environment, request);
  const values = { ...environment, OPENAI_API_KEY: environment.OPENAI_API_KEY || environment.OPEN_AI_API_KEY,
    ANTHROPIC_API_KEY: environment.ANTHROPIC_API_KEY || environment.CLAUDE_API_KEY };
  const missing = SECRETS.filter(name => !values[name]?.trim());
  if (missing.length) throw new Error(`Missing staging configuration: ${missing.join(', ')}.`);
  const neon = (args, extra = {}) => {
    const result = run('neon', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...environment, ...extra }, maxBuffer: 4e6 });
    if (result.status !== 0) {
      // The repository is public: name the cause without any connection string.
      const detail = `${result.stderr ?? ''}`.replace(/postgres(?:ql)?:\/\/\S+/g, 'postgresql://***').trim().split('\n').slice(-3).join(' ');
      throw new Error(`Neon CLI ${args[0]} failed for staging${detail ? `: ${detail.slice(0, 400)}` : '.'}`);
    }
    return result.stdout.trim();
  };
  const project = environment.NEON_PROJECT_ID, branch = environment.NEON_BRANCH_ID;
  const owner = neon(['connection-string', branch, '--project-id', project, '--role-name', 'neondb_owner']);
  // `env pull` evaluates neon.ts, which derives the worker's database URL from DATABASE_URL.
  neon(['env', 'pull', '--project-id', project, '--branch', branch, '--file', file], { DATABASE_URL: owner, DATABASE_URL_UNPOOLED: owner });
  const deployed = parseEnv(await readFile(file, 'utf8'));
  if (!deployed.NEON_FUNCTION_REPORTERWORKER_BASE_URL) throw new Error('The staging worker is not deployed: its URL is missing.');
  const role = (name, password) => {
    const url = new URL(owner);
    url.username = `reporter_${name}`; url.password = password; url.searchParams.set('sslmode', 'verify-full');
    return url.toString();
  };
  const settings = {
    REPORTER_DEPLOYMENT_MODE: 'cloud', REPORTER_ACCEPTANCE_TARGET: 'staging', REPORTER_DEFAULT_PORTAL_ID: PORTAL,
    DATABASE_URL: owner, DATABASE_URL_UNPOOLED: owner,
    REPORTER_DATABASE_URL: role('runtime', values.REPORTER_RUNTIME_PASSWORD), REPORTER_WORKER_DATABASE_URL: role('worker', values.REPORTER_WORKER_PASSWORD),
    REPORTER_WORKER_URL: deployed.NEON_FUNCTION_REPORTERWORKER_BASE_URL,
    ...Object.fromEntries(SECRETS.map(name => [name, values[name]])),
  };
  await appendFile(file, `\n${Object.entries(settings).map(([name, value]) => `${name}=${JSON.stringify(value)}`).join('\n')}\n`, { mode: 0o600 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) throw new Error('Use: node scripts/staging-env.mjs <file>, with the staging Neon identifiers, passwords and provider keys in the environment.');
  try { await writeStagingEnvironment(file); console.log(`Wrote the staging environment to ${file} (mode 0600).`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
