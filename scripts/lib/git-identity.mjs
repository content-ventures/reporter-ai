const GITHUB_NOREPLY = /^(\d+)\+([a-z\d](?:[a-z\d-]*[a-z\d])?)@users\.noreply\.github\.com$/i;

export function githubIdentityViolation(name, email, label = "Git identity") {
  const normalizedName = String(name || "").trim();
  const normalizedEmail = String(email || "").trim();
  const match = GITHUB_NOREPLY.exec(normalizedEmail);

  if (!match) {
    return `${label} must use the GitHub noreply address <account-id>+<login>@users.noreply.github.com, not a computer or personal identity`;
  }

  const login = match[2];
  if (normalizedName.toLowerCase() !== login.toLowerCase()) {
    return `${label} name must match the GitHub login "${login}", received "${normalizedName || "empty"}"`;
  }

  return null;
}

export function parseGitIdentity(value) {
  const match = /^(.*) <([^>]+)> \d+ [+-]\d{4}$/.exec(String(value || "").trim());
  return match ? { name: match[1], email: match[2] } : null;
}
