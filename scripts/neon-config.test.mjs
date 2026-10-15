import assert from "node:assert/strict";
import test from "node:test";

// Evaluating the config needs placeholder deployment values; nothing connects anywhere.
for (const name of ["REPORTER_WORKER_PASSWORD", "GROQ_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "PIXABAY_API_KEY"]) process.env[name] ??= "config-test-only";
process.env.DATABASE_URL ??= "postgresql://owner:placeholder@localhost/test";
process.env.REPORTER_APP_ORIGINS ??= "https://reporter.invalid";
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
