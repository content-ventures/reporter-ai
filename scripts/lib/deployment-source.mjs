export function deploymentSourceViolation({ environment, commitMessage, version }) {
  if (environment !== "production") return null;

  const expected = `chore(release): v${version}`;
  const subject = String(commitMessage || "").split("\n", 1)[0].trim();

  if (subject !== expected) {
    return `Production accepts only the approved release commit "${expected}"; received "${subject || "no Git commit message"}"`;
  }

  return null;
}
