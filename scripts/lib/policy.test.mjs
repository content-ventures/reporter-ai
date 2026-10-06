import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function runScript(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

test("accepts descriptive kebab-case branch names", () => {
  const result = runScript("scripts/validate-branch-name.mjs", ["version-history"]);
  assert.equal(result.status, 0, result.stderr);
});

test("rejects branch prefixes and coding-tool identities", () => {
  const slash = runScript("scripts/validate-branch-name.mjs", ["cloud/version-history"]);
  const tool = runScript("scripts/validate-branch-name.mjs", ["codex-version-history"]);

  assert.equal(slash.status, 1);
  assert.equal(tool.status, 1);
});

test("blocks direct pushes from main", () => {
  const result = runScript("scripts/validate-branch-name.mjs", ["--push", "main"]);
  assert.equal(result.status, 1);
});

test("accepts a concise English Conventional Commit", () => {
  const result = runScript("scripts/validate-commit-message.mjs", ["feat: add version history"]);
  assert.equal(result.status, 0, result.stderr);
});

test("rejects an unstructured or Portuguese commit subject", () => {
  const unstructured = runScript("scripts/validate-commit-message.mjs", ["add version history"]);
  const portuguese = runScript("scripts/validate-commit-message.mjs", ["feat: adiciona historico de versoes"]);

  assert.equal(unstructured.status, 1);
  assert.equal(portuguese.status, 1);
});
