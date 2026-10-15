import assert from "node:assert/strict";
import test from "node:test";
import { verifyGitHubRebaseCommitter } from "./github-rebase-identity.mjs";

const sha = "b73be3d1fbf4afab5b32e41d1ea80cafa7ec6f4d";
const record = {
  sha,
  author: { name: "fagundesjv", email: "269704659+fagundesjv@users.noreply.github.com" },
  committer: { name: "fagundesjv", email: "merger@example.com" },
};
const env = {
  GITHUB_ACTIONS: "true",
  GITHUB_EVENT_NAME: "push",
  GITHUB_REF: "refs/heads/main",
  GITHUB_REPOSITORY: "content-ventures/reporter-ai",
  GITHUB_ACTOR: "fagundesjv",
  GITHUB_ACTOR_ID: "269704659",
  GH_TOKEN: "test-token",
};
const account = { id: 269704659, login: "fagundesjv" };
const evidence = {
  commit: { sha, author: account, committer: account, commit: { author: record.author, committer: record.committer } },
  pulls: [{ number: 11, merged_at: "2026-10-15T10:44:58Z", base: { ref: "main", repo: { full_name: env.GITHUB_REPOSITORY } } }],
};

function options(change = {}) {
  const data = structuredClone(evidence);
  change.mutate?.(data);
  const calls = [];
  return {
    calls,
    env: { ...env, ...change.env },
    request: async (url, init) => {
      calls.push(url);
      assert.equal(init.headers.authorization, "Bearer test-token");
      assert.ok(init.signal instanceof AbortSignal);
      return { ok: true, json: async () => url.endsWith("/pulls") ? data.pulls : data.commit };
    },
  };
}

test("accepts the PR 11 rebase shape after GitHub confirms the exact accounts and merged PR", async () => {
  const input = options();
  await verifyGitHubRebaseCommitter(record, input);
  assert.deepEqual(input.calls, [
    `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/commits/${sha}`,
    `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/commits/${sha}/pulls`,
  ]);
});

test("cannot relax identity validation in local hooks, PRs or other branches", async () => {
  for (const context of [
    { GITHUB_ACTIONS: "false" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_EVENT_NAME: "workflow_dispatch" },
    { GITHUB_REF: "refs/heads/feature" },
    { GH_TOKEN: "" },
    { GITHUB_ACTOR_ID: "" },
    { GITHUB_REPOSITORY: "../another-repository" },
  ]) {
    const input = options({ env: context });
    await assert.rejects(verifyGitHubRebaseCommitter(record, input));
    assert.equal(input.calls.length, 0);
  }
  const input = options();
  await assert.rejects(verifyGitHubRebaseCommitter({ ...record, sha: "main" }, input));
  await assert.rejects(verifyGitHubRebaseCommitter({ ...record, author: record.committer }, input), /reviewed author/);
  assert.equal(input.calls.length, 0);
});

test("rejects unassociated accounts, impersonated mergers and mismatched commit metadata", async () => {
  for (const mutate of [
    data => { data.commit.committer = null; },
    data => { data.commit.committer = { id: 1, login: "another-user" }; },
    data => { data.commit.committer.login = "another-user"; },
    data => { data.commit.author = null; },
    data => { data.commit.author.id = 1; },
    data => { data.commit.author.login = "another-user"; },
    data => { data.commit.sha = "0".repeat(40); },
    data => { data.commit.commit.committer.email = "different@example.com"; },
    data => { data.commit.commit.committer.name = "different-name"; },
    data => { data.commit.commit.author.email = "different@example.com"; },
    data => { data.commit.commit.author.name = "different-name"; },
  ]) {
    await assert.rejects(verifyGitHubRebaseCommitter(record, options({ mutate })), /did not associate/);
  }
  await assert.rejects(verifyGitHubRebaseCommitter(record, options({ env: { GITHUB_ACTOR: "another-user" } })), /did not associate/);
});

test("requires a merged PR targeting this repository's main branch", async () => {
  for (const mutate of [
    data => { data.pulls = []; },
    data => { data.pulls = null; },
    data => { data.pulls[0].merged_at = null; },
    data => { data.pulls[0].base.ref = "feature"; },
    data => { data.pulls[0].base.repo.full_name = "someone/else"; },
  ]) {
    await assert.rejects(verifyGitHubRebaseCommitter(record, options({ mutate })), /merged pull request/);
  }
});

test("fails closed on API authorization, lookup or network failures without exposing credentials", async () => {
  for (const status of [401, 403, 404, 500]) {
    await assert.rejects(verifyGitHubRebaseCommitter(record, {
      env, request: async () => ({ ok: false, status }),
    }), error => error.message === `GitHub rebase identity lookup failed (HTTP ${status}).`);
  }
  await assert.rejects(verifyGitHubRebaseCommitter(record, {
    env, request: async () => { throw new Error("Network unavailable"); },
  }), /Network unavailable/);
});
