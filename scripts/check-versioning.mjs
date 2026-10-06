import { readFileSync } from "node:fs";
import { compareVersions, parseVersion, roadmapMajor } from "./lib/versioning.mjs";
import { fail } from "./lib/command.mjs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const history = JSON.parse(readFileSync("src/data/release-history.json", "utf8"));
const changelog = readFileSync("CHANGELOG.md", "utf8");

if (packageJson.version !== history.currentVersion) {
  fail(`package.json is v${packageJson.version}, but release history is v${history.currentVersion}`);
}

if (history.releases.length === 0 || history.releases[0].version !== history.currentVersion) {
  fail("the latest release-history entry must match the current version");
}

for (const [index, release] of history.releases.entries()) {
  const version = parseVersion(release.version);
  const expectedMajor = roadmapMajor(release.roadmapRelease);

  if (expectedMajor === null || version.major !== expectedMajor) {
    fail(`v${release.version} must match roadmap release ${release.roadmapRelease}`);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(release.date)) {
    fail(`v${release.version} must use an ISO release date`);
  }

  if (!release.summary || !Array.isArray(release.changes) || release.changes.length === 0) {
    fail(`v${release.version} requires a summary and at least one described change`);
  }

  const following = history.releases[index + 1];
  if (following && compareVersions(release.version, following.version) <= 0) {
    fail("release history must be ordered from newest to oldest without duplicate versions");
  }
}

if (!changelog.includes(`## [${history.currentVersion}]`)) {
  fail(`CHANGELOG.md does not contain v${history.currentVersion}`);
}

console.log(`Version policy passed: v${history.currentVersion} (${history.currentRoadmapRelease})`);
