import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import pg from 'pg';
import { resetEditorialRows } from './lib/editorial-rows.mjs';
import { writeStagingEnvironment } from './staging-env.mjs';

/**
 * The release acceptance on the persistent staging project, against the worker the release
 * just deployed there: real storage trigger, Groq transcription, one generated article and its
 * approval by a second user. It never touches production and creates no branch.
 */
if (!process.env.GITHUB_ACTIONS || !process.env.GITHUB_ACTOR) throw new Error('Staging acceptance runs only from the authenticated GitHub workflow.');
const directory = await mkdtemp(join(tmpdir(), 'reporter-staging-acceptance-')), file = join(directory, 'staging.env');
try {
  await writeStagingEnvironment(file);
  // Staging holds only acceptance data; each run starts from an empty editorial workspace.
  const settings = parseEnv(await readFile(file, 'utf8'));
  const url = new URL(settings.DATABASE_URL_UNPOOLED); url.searchParams.set('sslmode', 'verify-full');
  const db = new pg.Client({ connectionString: url.toString(), application_name: 'reporter-staging-acceptance' });
  await db.connect();
  try { await resetEditorialRows(db, '10000000-0000-0000-0000-000000000101'); } finally { await db.end(); }
  const flow = spawnSync(process.execPath, [`--env-file=${file}`, '--conditions=react-server', '--import', 'tsx', 'scripts/neon-flow-acceptance.mjs'], { stdio: 'inherit' });
  if (flow.status !== 0) throw new Error('Staging acceptance failed.');
  console.log(`PASS staging acceptance for ${process.env.GITHUB_SHA}.`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
