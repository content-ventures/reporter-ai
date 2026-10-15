import { githubIdentityViolation } from "./git-identity.mjs";

// GitHub's rebase keeps the reviewed author but replaces the committer with
// the merging account's configured email. Verify that account through GitHub;
// a personal email in an ordinary local/PR commit still fails the strict rule.
export async function verifyGitHubRebaseCommitter(record, {
  env = process.env,
  request = fetch,
} = {}) {
  const { sha, author, committer } = record;
  if (githubIdentityViolation(author.name, author.email)) {
    throw new Error("The reviewed author must retain its GitHub noreply identity.");
  }
  if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_EVENT_NAME !== "push" || env.GITHUB_REF !== "refs/heads/main") {
    throw new Error("GitHub rebase verification is only available for a main push in GitHub Actions.");
  }
  if (!/^[a-z\d](?:[a-z\d-]*[a-z\d])?\/[\w.-]+$/i.test(env.GITHUB_REPOSITORY || "") || !/^[a-f\d]{40}$/.test(sha)) {
    throw new Error("GitHub rebase verification requires an exact repository and commit SHA.");
  }
  if (!env.GH_TOKEN || !env.GITHUB_ACTOR || !/^\d+$/.test(env.GITHUB_ACTOR_ID || "")) {
    throw new Error("GitHub rebase verification requires the authenticated workflow actor.");
  }

  async function api(path) {
    const response = await request(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/${path}`, {
      headers: {
        authorization: `Bearer ${env.GH_TOKEN}`,
        accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`GitHub rebase identity lookup failed (HTTP ${response.status}).`);
    return response.json();
  }

  const commit = await api(`commits/${sha}`);
  const sameLogin = (left, right) => typeof left === "string" && left.toLowerCase() === right.toLowerCase();
  const authorIdentity = /^(\d+)\+([^@]+)@users\.noreply\.github\.com$/i.exec(author.email);
  if (commit.sha !== sha ||
      commit.commit?.author?.name !== author.name || commit.commit?.author?.email !== author.email ||
      commit.commit?.committer?.name !== committer.name || commit.commit?.committer?.email !== committer.email ||
      String(commit.author?.id) !== authorIdentity[1] || !sameLogin(commit.author?.login, authorIdentity[2]) ||
      String(commit.committer?.id) !== env.GITHUB_ACTOR_ID ||
      !sameLogin(commit.committer?.login, env.GITHUB_ACTOR) || !sameLogin(committer.name, env.GITHUB_ACTOR)) {
    throw new Error("GitHub did not associate this exact commit with its reviewed author and authenticated merger.");
  }

  const pulls = await api(`commits/${sha}/pulls`);
  const merged = Array.isArray(pulls) && pulls.some(pull =>
    pull.merged_at && pull.base?.ref === "main" &&
    pull.base?.repo?.full_name === env.GITHUB_REPOSITORY,
  );
  if (!merged) throw new Error("The GitHub commit must belong to a merged pull request targeting this main branch.");
}
