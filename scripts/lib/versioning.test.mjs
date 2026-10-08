import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReleaseViolations,
  compareVersions,
  nextVersion,
  parseVersion,
  releaseChangeFromSubject,
  upcomingViolations,
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

const history = (overrides = {}) => ({
  currentVersion: "0.1.0",
  currentRoadmapRelease: "R0",
  releases: [{ version: "0.1.0", roadmapRelease: "R0" }],
  upcoming: { roadmapRelease: "R1", title: "Experiência", summary: "Resumo.", changes: [{ type: "Added", description: "Logs." }] },
  ...overrides,
});

test("validates the Em preparação block of Novidades", () => {
  assert.deepEqual(upcomingViolations(history()), []);
  assert.deepEqual(upcomingViolations(history({ upcoming: undefined })), []);
  assert.match(upcomingViolations(history({ upcoming: { ...history().upcoming, roadmapRelease: "R2" } })).join(), /current \(R0\) or the next/);
  assert.match(upcomingViolations(history({ upcoming: { ...history().upcoming, version: "1.0.0" } })).join(), /no version or date/);
  assert.match(upcomingViolations(history({ upcoming: { ...history().upcoming, changes: [] } })).join(), /at least one/);
  assert.match(upcomingViolations(history({ upcoming: { ...history().upcoming, changes: [{ type: "Maintenance", description: "x" }] } })).join(), /known type/);
  assert.match(
    upcomingViolations(history({ currentRoadmapRelease: "R0", releases: [{ version: "1.0.0", roadmapRelease: "R1" }] })).join(),
    /already released/,
  );
});

test("the build release is the released one or the announced next one", () => {
  assert.deepEqual(buildReleaseViolations(history(), "R0"), []);
  assert.deepEqual(buildReleaseViolations(history(), "R1"), []);
  assert.match(buildReleaseViolations(history({ upcoming: undefined }), "R1").join(), /announce it/);
  assert.match(buildReleaseViolations(history(), "R2").join(), /history is at R0/);
});
