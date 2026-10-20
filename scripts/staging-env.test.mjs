import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import test from 'node:test';

const staging = { REPORTER_ACCEPTANCE_TARGET: 'staging', NEON_API_KEY: 'key', NEON_PROJECT_ID: 'stage', NEON_BRANCH_ID: 'br-stage',
  REPORTER_WORKER_PASSWORD: 'worker', REPORTER_RUNTIME_PASSWORD: 'runtime', REPORTER_APP_ORIGINS: 'https://staging.example.test',
  GROQ_API_KEY: 'groq', OPENAI_API_KEY: 'openai', ANTHROPIC_API_KEY: 'anthropic', PIXABAY_API_KEY: 'pixabay', TAVILY_API_KEY: 'tavily' };
const owner = 'postgresql://neondb_owner:owner-secret@ep-stage.example.test/neondb';
const request = async () => Response.json({ branch: { id: 'br-stage', protected: false } });

test('the staging env pull gets the owner connection neon.ts needs, and a failure never prints it', async () => {
  const { writeStagingEnvironment } = await import('./staging-env.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'reporter-staging-env-')), file = join(directory, 'staging.env');
  try {
    const calls = [];
    const run = (_command, args, options) => {
      calls.push({ args, env: options.env });
      if (args[0] === 'connection-string') return { status: 0, stdout: `${owner}\n` };
      if (!options.env.DATABASE_URL) return { status: 1, stderr: 'DATABASE_URL is required to deploy Reporter AI Functions' };
      writeFileSync(file, 'NEON_FUNCTION_REPORTERWORKER_BASE_URL=https://br-stage-reporterworker.example.test/\n');
      return { status: 0, stdout: '' };
    };
    await writeStagingEnvironment(file, staging, { run, request });
    assert.equal(calls.find(call => call.args[0] === 'env').env.DATABASE_URL, owner);
    const settings = parseEnv(await readFile(file, 'utf8'));
    assert.equal(settings.REPORTER_WORKER_URL, 'https://br-stage-reporterworker.example.test/');
    assert.match(settings.REPORTER_DATABASE_URL, /^postgresql:\/\/reporter_runtime:runtime@/);

    const failing = (_command, args) => args[0] === 'connection-string' ? { status: 0, stdout: owner }
      : { status: 1, stderr: `could not reach ${owner}\nError: branch is not ready` };
    const error = await writeStagingEnvironment(file, staging, { run: failing, request }).catch(caught => caught);
    assert.match(error.message, /Neon CLI env failed for staging: .*branch is not ready/);
    assert.ok(!error.message.includes('owner-secret'), 'a public log never shows the owner password');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
