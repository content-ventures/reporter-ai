import { spawnSync } from "node:child_process";
import { fail } from "./lib/command.mjs";
import { githubIdentityViolation, parseGitIdentity } from "./lib/git-identity.mjs";

function git(args) {
  const result = spawnSync("git", args, { cwd: process.cwd(), encoding: "utf8" });
  if (result.status !== 0) fail(result.stderr.trim() || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

function validate(name, email, label) {
  const violation = githubIdentityViolation(name, email, label);
  if (violation) fail(violation);
}

const rangeIndex = process.argv.indexOf("--range");
if (rangeIndex >= 0) {
  const range = process.argv[rangeIndex + 1];
  if (!range) fail("--range requires a Git revision range");

  const records = git(["log", "--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1e", range])
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean);

  if (records.length === 0) fail(`no commits found in ${range}`);

  for (const record of records) {
    const [commit, authorName, authorEmail, committerName, committerEmail] = record.split("\x1f");
    validate(authorName, authorEmail, `Commit ${commit.slice(0, 12)} author`);
    validate(committerName, committerEmail, `Commit ${commit.slice(0, 12)} committer`);
  }

  console.log(`GitHub identity policy passed for ${records.length} commits in ${range}`);
  process.exit(0);
}

for (const kind of ["AUTHOR", "COMMITTER"]) {
  const identity = parseGitIdentity(git(["var", `GIT_${kind}_IDENT`]));
  if (!identity) fail(`could not read the Git ${kind.toLowerCase()} identity`);
  validate(identity.name, identity.email, `Git ${kind.toLowerCase()}`);
}

console.log("GitHub identity policy passed for the configured author and committer");
