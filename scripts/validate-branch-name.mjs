import { run, fail } from "./lib/command.mjs";

const protectedBranches = new Set(["main"]);
const toolNames = new Set([
  "agent",
  "chatgpt",
  "claude",
  "cloud",
  "codex",
  "copilot",
  "cursor",
  "gemini",
]);

const args = process.argv.slice(2);
const isPush = args.includes("--push");
const suppliedName = args.find((argument) => !argument.startsWith("--"));
const branchName = suppliedName || run("git", ["branch", "--show-current"]);

if (!branchName) {
  fail("a branch name is required; detached HEAD is not accepted for local work");
}

if (protectedBranches.has(branchName)) {
  if (isPush) {
    fail("direct pushes to main are blocked; finish the work on a descriptive branch and open one final PR");
  }

  console.log(`Branch policy passed for protected branch: ${branchName}`);
  process.exit(0);
}

if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(branchName)) {
  fail("working branches must use descriptive English kebab-case without slashes (example: development-harness)");
}

const parts = branchName.split("-");
const forbiddenPart = parts.find((part) => toolNames.has(part));

if (forbiddenPart) {
  fail(`branch names must describe the work, not an agent, tool, or environment (found: ${forbiddenPart})`);
}

console.log(`Branch policy passed: ${branchName}`);
