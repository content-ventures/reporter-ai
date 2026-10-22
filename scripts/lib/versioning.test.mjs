import assert from "node:assert/strict";
import test from "node:test";
import {
  automaticReleaseSummary,
  buildReleaseViolations,
  compareVersions,
  nextVersion,
  parseVersion,
  releaseBumpFromSubjects,
  releaseChangeFromSubject,
  roadmapReleaseFromSubject,
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

test("derives the automatic deploy version from validated commits", () => {
  assert.equal(releaseBumpFromSubjects(["fix: repair uploads"]), "patch");
  assert.equal(releaseBumpFromSubjects(["docs: explain uploads", "feat: add direct uploads"]), "minor");
  assert.throws(() => releaseBumpFromSubjects(["feat(storage)!: replace upload protocol"]), /require an explicit roadmap release/);
  assert.throws(() => releaseBumpFromSubjects([]), /At least one commit/);
});

test("each accepted roadmap release advances the major version only on declaration", () => {
  const r1 = "chore(release): declare R1 roadmap release";
  const r2 = "chore(release): declare R2 roadmap release";
  assert.equal(roadmapReleaseFromSubject(r1), "R1");
  assert.equal(roadmapReleaseFromSubject(r2), "R2");
  const context = { currentVersion: "0.20.1", currentRoadmapRelease: "R0" };
  assert.equal(releaseBumpFromSubjects([
    "feat(news): prepare the news desk",
    r1,
  ], context), "major");
  assert.equal(nextVersion(context.currentVersion, "major", "R1"), "1.0.0");
  assert.equal(releaseBumpFromSubjects([r2], {
    currentVersion: "1.7.3", currentRoadmapRelease: "R1",
  }), "major");
  assert.equal(nextVersion("1.7.3", "major", "R2"), "2.0.0");
  assert.throws(() => releaseBumpFromSubjects([r2], context), /requires one declaration for the next release/);
  assert.throws(() => releaseBumpFromSubjects([r1, r1], context), /requires one declaration/);
  assert.throws(() => releaseBumpFromSubjects([
    r1, "not a valid commit",
  ], context), /Cannot calculate a release bump/);
  assert.throws(() => roadmapReleaseFromSubject("chore(release): declare R8 roadmap release"), /Invalid roadmap release/);
});

test("creates an automatic explanation for the deployment", () => {
  assert.equal(
    automaticReleaseSummary([
      { type: "Added", description: "Add direct uploads" },
      { type: "Fixed", description: "Repair text ingestion" },
      { type: "Changed", description: "Clarify deployment feedback" },
      { type: "Maintenance", description: "Cover release policy" },
    ], "minor"),
    "Automatic feature release with 4 validated changes: cover release policy; clarify deployment feedback; repair text ingestion.",
  );
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
  assert.deepEqual(upcomingViolations(history({ upcoming: {
    ...history().upcoming,
    roadmapReleaseNotes: { summary: "First roadmap release.", changes: [{ type: "Added", description: "Ship the R1 flow" }] },
  } })), []);
  assert.match(upcomingViolations(history({ upcoming: {
    ...history().upcoming,
    roadmapReleaseNotes: { summary: "Curto", changes: [] },
  } })).join(), /roadmap release/);
});

test("the build release is the released one or the announced next one", () => {
  assert.deepEqual(buildReleaseViolations(history(), "R0"), []);
  assert.deepEqual(buildReleaseViolations(history(), "R1"), []);
  assert.match(buildReleaseViolations(history({ upcoming: undefined }), "R1").join(), /announce it/);
  assert.match(buildReleaseViolations(history(), "R2").join(), /history is at R0/);
});
