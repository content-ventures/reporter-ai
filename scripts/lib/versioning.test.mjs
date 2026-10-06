import assert from "node:assert/strict";
import test from "node:test";
import {
  compareVersions,
  nextVersion,
  parseVersion,
  releaseChangeFromSubject,
} from "./versioning.mjs";

test("parses and compares semantic versions", () => {
  assert.deepEqual(parseVersion("2.3.4"), { major: 2, minor: 3, patch: 4 });
  assert.equal(compareVersions("2.0.0", "1.9.9"), 1);
  assert.throws(() => parseVersion("v2.3"), /Invalid semantic version/);
});

test("maps roadmap releases to major versions", () => {
  assert.equal(nextVersion("0.4.2", "major", "R1"), "1.0.0");
  assert.equal(nextVersion("1.6.3", "major", "R2"), "2.0.0");
  assert.throws(() => nextVersion("1.6.3", "major", "R3"), /must be R2/);
});

test("increments features and fixes independently", () => {
  assert.equal(nextVersion("1.2.7", "minor", "R1"), "1.3.0");
  assert.equal(nextVersion("1.2.7", "patch", "R1"), "1.2.8");
});

test("creates readable release changes from conventional commits", () => {
  assert.deepEqual(releaseChangeFromSubject("feat(history): add public timeline"), {
    type: "Added",
    description: "Add public timeline",
  });
  assert.deepEqual(releaseChangeFromSubject("fix: handle empty release notes"), {
    type: "Fixed",
    description: "Handle empty release notes",
  });
});
