import assert from "node:assert/strict";
import test from "node:test";
import { deploymentSourceViolation } from "./deployment-source.mjs";

test("allows local and preview builds without creating a release", () => {
  assert.equal(deploymentSourceViolation({ environment: undefined, commitMessage: "feat: add uploads", version: "0.2.0" }), null);
  assert.equal(deploymentSourceViolation({ environment: "preview", commitMessage: "feat: add uploads", version: "0.2.0" }), null);
});

test("allows only the matching version commit in production", () => {
  assert.equal(
    deploymentSourceViolation({ environment: "production", commitMessage: "chore(release): v0.2.0", version: "0.2.0" }),
    null,
  );
  assert.match(
    deploymentSourceViolation({ environment: "production", commitMessage: "feat: add uploads", version: "0.2.0" }),
    /Production accepts only the approved release commit/,
  );
  assert.match(
    deploymentSourceViolation({ environment: "production", commitMessage: "chore\(release\): v0.1.1", version: "0.2.0" }),
    /chore\(release\): v0.2.0/,
  );
});
