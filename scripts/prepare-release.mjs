import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { run, fail } from "./lib/command.mjs";
import {
  automaticReleaseSummary,
  nextVersion,
  releaseBumpFromSubjects,
  releaseChangeFromSubject,
  roadmapReleaseFromSubject,
} from "./lib/versioning.mjs";

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function refExists(ref) {
  return spawnSync("git", ["rev-parse", "--verify", "--quiet", ref], {
    cwd: process.cwd(),
  }).status === 0;
}

function groupedMarkdown(changes) {
  const groups = new Map();

  for (const change of changes) {
    const entries = groups.get(change.type) || [];
    entries.push(change.description);
    groups.set(change.type, entries);
  }

  return [...groups.entries()]
    .map(([type, entries]) => `### ${type}\n\n${entries.map((entry) => `- ${entry}.`).join("\n")}`)
    .join("\n\n");
}

const automatic = process.argv.includes("--auto");
let bump = option("bump");
let requestedRoadmap = option("roadmap");
let summary = option("summary");

if (!automatic && (!bump || !requestedRoadmap || !summary)) {
  fail("release:prepare requires --auto or --bump, --roadmap, and --summary");
}

if (run("git", ["status", "--porcelain"])) {
  fail("release preparation requires a clean working tree");
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const historyPath = "src/data/release-history.json";
const history = JSON.parse(readFileSync(historyPath, "utf8"));
const currentRelease = history.releases[0];

const currentTag = `v${packageJson.version}`;
const baseline = refExists(`refs/tags/${currentTag}`) ? currentTag : currentRelease.commit;

if (!baseline || !refExists(baseline)) {
  fail(`cannot locate the baseline for ${currentTag}`);
}

const log = run("git", ["log", "--reverse", "--format=%s", `${baseline}..HEAD`]);
const subjects = log
  .split("\n")
  .filter(Boolean)
  .filter((subject) => !/^chore\(release\): v\d+\.\d+\.\d+$/.test(subject));

if (subjects.length === 0) {
  fail("there are no validated commits to include in this release");
}

const declaration = subjects.map(roadmapReleaseFromSubject).find(Boolean);
const roadmapNotes = declaration && history.upcoming?.roadmapRelease === declaration
  ? history.upcoming.roadmapReleaseNotes
  : undefined;
if (declaration && (!roadmapNotes?.summary || !Array.isArray(roadmapNotes.changes) || roadmapNotes.changes.length === 0)) {
  fail("a roadmap release requires reviewed release notes in release-history upcoming");
}
const commitChanges = subjects
  .filter((subject) => !roadmapReleaseFromSubject(subject))
  .map(releaseChangeFromSubject);
const changes = [
  ...(roadmapNotes?.changes ?? []),
  ...commitChanges,
];

if (automatic) {
  bump = releaseBumpFromSubjects(subjects, {
    currentVersion: packageJson.version,
    currentRoadmapRelease: history.currentRoadmapRelease,
  });
  requestedRoadmap = bump === "major"
    ? `R${Number(history.currentRoadmapRelease.slice(1)) + 1}`
    : history.currentRoadmapRelease;
  summary = roadmapNotes?.summary ?? automaticReleaseSummary(changes, bump);
}

if ((bump === "major" || declaration) && (bump !== "major" || requestedRoadmap !== declaration)) {
  fail("a major version requires a matching roadmap release declaration");
}

if (!/^[\x20-\x7E]+$/.test(summary) || summary.length < 12) {
  fail("the release summary must be a clear English sentence");
}

if (bump !== "major" && requestedRoadmap !== history.currentRoadmapRelease) {
  fail(`${bump} releases must remain in ${history.currentRoadmapRelease}`);
}

const next = nextVersion(packageJson.version, bump, requestedRoadmap);
const date = new Date().toISOString().slice(0, 10);
const title = bump === "major"
  ? `${requestedRoadmap} roadmap release`
  : bump === "minor"
    ? `${requestedRoadmap} feature release`
    : `${requestedRoadmap} maintenance release`;
const publicSummary = roadmapNotes ? history.upcoming.summary : summary;
const publicChanges = roadmapNotes ? [...history.upcoming.changes, ...commitChanges] : changes;

packageJson.version = next;
history.currentVersion = next;
history.currentRoadmapRelease = requestedRoadmap;
// The "Em preparação" block ships with its roadmap release (its notes become this entry's context).
if (bump === "major" && history.upcoming?.roadmapRelease === requestedRoadmap) {
  delete history.upcoming;
}
history.releases.unshift({
  version: next,
  roadmapRelease: requestedRoadmap,
  date,
  title,
  summary: publicSummary,
  commit: null,
  changes: publicChanges,
});

writeFileSync("package.json", `${JSON.stringify(packageJson, null, 2)}\n`);
writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`);

const changelogPath = "CHANGELOG.md";
const changelog = readFileSync(changelogPath, "utf8");
const unreleasedStart = changelog.indexOf("## [Unreleased]");
const previousReleaseStart = changelog.indexOf("\n## [", unreleasedStart + 1);

if (unreleasedStart < 0 || previousReleaseStart < 0) {
  fail("CHANGELOG.md must contain Unreleased and at least one released version");
}

const releaseSection = `## [${next}] - ${date}\n\n${groupedMarkdown(changes)}\n\n`;
const updatedChangelog = `${changelog.slice(0, unreleasedStart)}## [Unreleased]\n\n${releaseSection}${changelog.slice(previousReleaseStart + 1)}`;
writeFileSync(changelogPath, updatedChangelog);

const releaseNotesPath = process.env.RELEASE_NOTES_PATH;
if (releaseNotesPath) {
  writeFileSync(
    releaseNotesPath,
    `# Reporter IA v${next}\n\n${summary}\n\n${groupedMarkdown(changes)}\n`,
  );
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${next}\ntag=v${next}\nsummary=${summary}\n`);
}

console.log(`Prepared v${next} with ${changes.length} changes from ${baseline}`);
