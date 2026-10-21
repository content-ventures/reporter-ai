import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import packageJson from '../package.json' with { type: 'json' };
import { appHealth, workerFingerprint } from '../src/server/app-config.ts';
import { handleReporter } from '../src/server/http.ts';

const CLOUD = {
  REPORTER_DATABASE_URL: 'postgresql://reporter_runtime:secret-runtime@db.example.test/reporter', NEON_AUTH_BASE_URL: 'https://auth.example.test',
  NEON_AUTH_COOKIE_SECRET: 'secret-cookie-value', REPORTER_WORKER_URL: 'https://worker.example.test/', REPORTER_WORKER_PASSWORD: 'secret-worker',
  GROQ_API_KEY: 'secret-groq', OPENAI_API_KEY: 'secret-openai', CLAUDE_API_KEY: 'secret-claude', PIXABAY_API_KEY: 'secret-pixabay', TAVILY_API_KEY: 'secret-tavily',
  VERCEL_GIT_COMMIT_SHA: 'abc1234', VERCEL_ENV: 'production',
};

function withMode<T>(mode: string, run: () => T): T {
  const previous = process.env.REPORTER_DEPLOYMENT_MODE;
  process.env.REPORTER_DEPLOYMENT_MODE = mode;
  try { return run(); } finally { if (previous === undefined) delete process.env.REPORTER_DEPLOYMENT_MODE; else process.env.REPORTER_DEPLOYMENT_MODE = previous; }
}

test('the health probe reports version, commit and readiness, never a configured value', () => withMode('cloud', () => {
  const health = appHealth(CLOUD);
  assert.deepEqual([health.version, health.commit, health.environment, health.ready], [packageJson.version, 'abc1234', 'production', true]);
  assert.equal(health.worker, workerFingerprint('https://worker.example.test'));
  const text = JSON.stringify(health);
  for (const [name, value] of Object.entries(CLOUD)) if (name.includes('SECRET') || /secret|example/.test(value)) assert.equal(text.includes(value), false, name);
  const missing = appHealth({ ...CLOUD, NEON_AUTH_COOKIE_SECRET: ' ', OPENAI_API_KEY: undefined });
  assert.equal(missing.ready, false);
  assert.deepEqual(Object.entries(missing.configured).filter(([, ok]) => !ok).map(([name]) => name), ['auth', 'openai']);
  assert.equal(appHealth({ ...CLOUD, OPENAI_API_KEY: undefined, OPEN_AI_API_KEY: 'alias' }).configured.openai, true, 'the provider aliases count');
}));

test('the probe answers without a session and without touching the database', async () => {
  const globals = globalThis as typeof globalThis & { reporterPools?: Partial<Record<'runtime' | 'worker', Pool>> };
  const previous = globals.reporterPools;
  globals.reporterPools = { runtime: { connect: async () => { throw new Error('The health probe must not reach the database'); } } as unknown as Pool };
  try {
    const response = await withMode('cloud', () => handleReporter(new Request('https://app.example.test/api/reporter/health'), ['health'],
      { identify: async () => { throw new Error('The health probe must not read a session'); } }));
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { service: string }).service, 'reporter-ai');
  } finally { globals.reporterPools = previous; }
});

test('the read-only release check agrees with the probe and names what is missing', async () => {
  const { healthProblems, waitForAppHealth, workerFingerprint: scriptFingerprint } = await import('../scripts/check-app-health.mjs');
  assert.equal(scriptFingerprint('https://worker.example.test/path'), workerFingerprint('https://worker.example.test'));
  const health = withMode('cloud', () => appHealth(CLOUD));
  assert.deepEqual(healthProblems(health, { version: packageJson.version, commit: 'abc1234', worker: 'https://worker.example.test' }), []);
  assert.deepEqual(healthProblems(health, { version: '9.9.9', worker: 'https://other.example.test' }),
    [`version ${packageJson.version}, expected 9.9.9`, 'the app wakes a different worker']);
  assert.deepEqual(healthProblems(health, { workerFingerprint: workerFingerprint('https://worker.example.test') }), []);
  assert.deepEqual(healthProblems(health, { workerFingerprint: '0123456789abcdef' }), ['the app wakes a different worker']);
  const unready = withMode('cloud', () => appHealth({ ...CLOUD, PIXABAY_API_KEY: undefined }));
  assert.deepEqual(healthProblems(unready), ['missing settings: pixabay']);
  // The fact check's key is optional: reported, never a reason the deployment is unready.
  const withoutSearch = withMode('cloud', () => appHealth({ ...CLOUD, TAVILY_API_KEY: undefined }));
  assert.deepEqual([withoutSearch.ready, withoutSearch.optional.tavily], [true, false]);
  assert.deepEqual([withoutSearch.ready, withoutSearch.optional.gemini], [true, false]);
  assert.equal(withMode('cloud', () => appHealth({ ...CLOUD, GOOGLE_API_KEY: 'synthetic-google-key' })).optional.gemini, true);
  let calls = 0;
  const answers = [new Response('down', { status: 502 }), Response.json({ ...health, version: '0.0.1' }), Response.json(health)];
  const reached = await waitForAppHealth('https://app.example.test', { version: packageJson.version },
    { sleep: async () => {}, request: async () => answers[calls++] });
  assert.deepEqual([reached.version, calls], [packageJson.version, 3], 'it waits until the expected version is live');
  await assert.rejects(waitForAppHealth('https://app.example.test', { version: '9.9.9' }, { attempts: 2, sleep: async () => {}, request: async () => Response.json(health) }),
    /did not report the expected release: version/);
});
