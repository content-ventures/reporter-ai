import assert from "node:assert/strict";
import test from "node:test";
import { githubIdentityViolation, parseGitIdentity } from "./git-identity.mjs";

test("accepts a GitHub login with its numeric noreply address", () => {
  assert.equal(githubIdentityViolation("fagundesjv", "269704659+fagundesjv@users.noreply.github.com"), null);
});

test("rejects computer, personal and mismatched identities", () => {
  assert.match(githubIdentityViolation("joaovitor", "joaovitor@MacBook.local"), /GitHub noreply/);
  assert.match(githubIdentityViolation("fagundesjv", "person@example.com"), /GitHub noreply/);
  assert.match(githubIdentityViolation("João Vitor", "269704659+fagundesjv@users.noreply.github.com"), /must match the GitHub login/);
});

test("parses the identity emitted by git var", () => {
  assert.deepEqual(
    parseGitIdentity("fagundesjv <269704659+fagundesjv@users.noreply.github.com> 1791972000 -0300"),
    { name: "fagundesjv", email: "269704659+fagundesjv@users.noreply.github.com" },
  );
  assert.equal(parseGitIdentity("invalid"), null);
});
