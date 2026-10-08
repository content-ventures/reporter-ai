import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke e2e (`pnpm smoke`): the main path of R1 · Experiência and a route sweep at 1440 and 390.
 *
 * Locally it reuses the server already listening on the base URL (usually `pnpm dev`); with no
 * server, or in CI, it builds and starts the production server (`SMOKE_PREBUILT=1`: the build is
 * already there, as in CI, so it only starts it). `SMOKE_BASE_URL` points the smoke at any running
 * build (the acceptance build, for example) without starting one.
 */

const port = Number(process.env.SMOKE_PORT ?? 3000);
const external = process.env.SMOKE_BASE_URL;
const baseURL = external ?? `http://localhost:${port}`;
const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  workers: ci ? 2 : 3,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: ci ? [["github"], ["list"]] : [["list"]],
  outputDir: "test-results",
  use: {
    baseURL,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: external
    ? undefined
    : {
        command: `${process.env.SMOKE_PREBUILT ? "" : "pnpm build && "}pnpm start --port ${port}`,
        url: baseURL,
        reuseExistingServer: !ci,
        timeout: 300_000,
        stdout: "ignore",
        stderr: "pipe",
      },
});
