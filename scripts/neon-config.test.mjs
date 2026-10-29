import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from 'node:fs/promises';

// Evaluating the config needs placeholder deployment values; nothing connects anywhere.
for (const name of ["REPORTER_WORKER_PASSWORD", "GROQ_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "PIXABAY_API_KEY", "TAVILY_API_KEY"]) process.env[name] ??= "config-test-only";
process.env.DATABASE_URL ??= "postgresql://owner:placeholder@localhost/test";
process.env.REPORTER_APP_ORIGINS ??= "https://reporter.invalid";
process.env.GEMINI_API_KEY = "gemini-config-test-only";
process.env.GOOGLE_API_KEY = "google-config-test-only";
const { default: config } = await import("../neon.ts");

test("no schedule wakes the database more often than hourly", () => {
  const schedules = Object.entries(config.triggers).filter(([, trigger]) => trigger.type === "schedule");
  assert.ok(schedules.length > 0, "a safety sweep exists");
  for (const [name, trigger] of schedules) {
    const [minute] = trigger.cron.trim().split(/\s+/);
    assert.match(minute, /^[0-5]?\d$/, `${name} fires at a single minute of each hour, not "${trigger.cron}"`);
  }
});

test("the worker reads its allowed origins from the deployment, never a hard-coded production URL", () => {
  const env = config.functions.reporterworker.env;
  assert.equal(env.REPORTER_APP_ORIGINS, process.env.REPORTER_APP_ORIGINS);
  assert.equal("REPORTER_APP_ORIGIN" in env, false);
});

test('the memory worker is enabled only by an explicit environment setting', async () => {
  const previous = process.env.REPORTER_MEMORY_MODE;
  try {
    delete process.env.REPORTER_MEMORY_MODE;
    const disabled = await import('../neon.ts?memory-disabled');
    assert.equal(disabled.default.functions.reporterworker.env.REPORTER_MEMORY_MODE, 'off');
    process.env.REPORTER_MEMORY_MODE = 'on';
    const enabled = await import('../neon.ts?memory-enabled');
    assert.equal(enabled.default.functions.reporterworker.env.REPORTER_MEMORY_MODE, 'on');
    const workflow = await readFile(new URL('../.github/workflows/worker-deploy.yml', import.meta.url), 'utf8');
    assert.match(workflow, /REPORTER_MEMORY_MODE: \$\{\{ vars\.REPORTER_MEMORY_MODE \}\}/);
    assert.match(workflow, /'REPORTER_APP_ORIGINS', 'REPORTER_MEMORY_MODE', 'REPORTER_WORKER_PASSWORD'/);
  } finally {
    if (previous === undefined) delete process.env.REPORTER_MEMORY_MODE;
    else process.env.REPORTER_MEMORY_MODE = previous;
  }
});

test("Gemini is optional and its Google alias is normalized into the worker environment", async () => {
  assert.equal(config.functions.reporterworker.env.GEMINI_API_KEY, 'gemini-config-test-only');
  delete process.env.GEMINI_API_KEY;
  const aliased = await import('../neon.ts?gemini-alias');
  assert.equal(aliased.default.functions.reporterworker.env.GEMINI_API_KEY, 'google-config-test-only');
  delete process.env.GOOGLE_API_KEY;
  const without = await import('../neon.ts?gemini-absent');
  assert.equal('GEMINI_API_KEY' in without.default.functions.reporterworker.env, false);
});

test('release workflows pass the optional Gemini alias through deployment and acceptance', async () => {
  const worker = await readFile(new URL('../.github/workflows/worker-deploy.yml', import.meta.url), 'utf8');
  const release = await readFile(new URL('../.github/workflows/controlled-release.yml', import.meta.url), 'utf8');
  for (const workflow of [worker, release]) assert.match(workflow, /GEMINI_API_KEY: \$\{\{ secrets\.GEMINI_API_KEY \|\| secrets\.GOOGLE_API_KEY \}\}/);
  assert.match(worker, /\['TAVILY_API_KEY', 'GEMINI_API_KEY'\]\.filter/);
  const required = worker.match(/for name in ([^;]+);/)[1];
  assert.doesNotMatch(required, /GEMINI_API_KEY|GOOGLE_API_KEY/);
});
