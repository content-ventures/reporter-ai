import { run, fail } from "./lib/command.mjs";

const MAX_FILES = 20;
const MAX_LINES = 800;
const ignoredFiles = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

function measure(numstat) {
  const entries = numstat
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [added, deleted, ...pathParts] = line.split("\t");
      return { added, deleted, path: pathParts.join("\t") };
    })
    .filter(({ path }) => !ignoredFiles.has(path));

  const lines = entries.reduce((total, entry) => {
    const added = entry.added === "-" ? 0 : Number(entry.added);
    const deleted = entry.deleted === "-" ? 0 : Number(entry.deleted);
    return total + added + deleted;
  }, 0);

  return { files: entries.length, lines };
}

function assertMedium(label, numstat) {
  const size = measure(numstat);

  if (size.files > MAX_FILES || size.lines > MAX_LINES) {
    fail(`${label} is too large (${size.files} files, ${size.lines} lines); split it into cohesive medium commits (maximum ${MAX_FILES} files and ${MAX_LINES} changed lines, excluding lockfiles)`);
  }

  console.log(`Change-size policy passed for ${label}: ${size.files} files, ${size.lines} lines`);
}

const args = process.argv.slice(2);
const rangeIndex = args.indexOf("--range");

if (rangeIndex >= 0) {
  const range = args[rangeIndex + 1];

  if (!range) {
    fail("--range requires a Git revision range");
  }

  const commits = run("git", ["rev-list", "--reverse", range]).split("\n").filter(Boolean);

  for (const commit of commits) {
    const subject = run("git", ["show", "-s", "--format=%s", commit]);
    const stats = run("git", ["diff-tree", "--root", "--no-commit-id", "--numstat", "-r", commit]);
    assertMedium(`${commit.slice(0, 8)} (${subject})`, stats);
  }

  process.exit(0);
}

const staged = run("git", ["diff", "--cached", "--numstat"]);
assertMedium("staged change", staged);
