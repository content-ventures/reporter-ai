import assert from "node:assert/strict";
import test from "node:test";
import { ignoreBuildStepExitCode } from "./vercel-ignore-build.mjs";

test("Vercel skips ordinary production commits before they become failed deployments", () => {
  assert.equal(
    ignoreBuildStepExitCode({ environment: "production", commitMessage: "fix(runtime): restore Vercel uploads", version: "0.1.0" }),
    0,
  );
});

test("Vercel continues the build for the approved production release commit", () => {
  assert.equal(
    ignoreBuildStepExitCode({ environment: "production", commitMessage: "chore(release): v0.1.0", version: "0.1.0" }),
    1,
  );
});

test("Vercel continues Preview and local builds without creating a release", () => {
  assert.equal(ignoreBuildStepExitCode({ environment: "preview", commitMessage: "feat: new flow", version: "0.1.0" }), 1);
  assert.equal(ignoreBuildStepExitCode({ environment: undefined, commitMessage: "feat: new flow", version: "0.1.0" }), 1);
});
