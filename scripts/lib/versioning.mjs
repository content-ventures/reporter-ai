const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseVersion(version) {
  const match = VERSION_PATTERN.exec(version);

  if (!match) {
    throw new Error(`Invalid semantic version: ${version}`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function nextVersion(currentVersion, bump, roadmapRelease) {
  const current = parseVersion(currentVersion);

  if (bump === "major") {
    const match = /^R([1-7])$/.exec(roadmapRelease);

    if (!match) {
      throw new Error("A commercial release requires a roadmap value from R1 to R7");
    }

    const targetMajor = Number(match[1]);

    if (targetMajor !== current.major + 1) {
      throw new Error(`The next commercial release after v${currentVersion} must be R${current.major + 1}`);
    }

    return `${targetMajor}.0.0`;
  }

  if (bump === "minor") {
    return `${current.major}.${current.minor + 1}.0`;
  }

  if (bump === "patch") {
    return `${current.major}.${current.minor}.${current.patch + 1}`;
  }

  throw new Error(`Unsupported release bump: ${bump}`);
}

const changeTypeByCommitType = {
  feat: "Added",
  fix: "Fixed",
  docs: "Documentation",
  perf: "Improved",
  refactor: "Changed",
  revert: "Reverted",
  build: "Maintenance",
  chore: "Maintenance",
  ci: "Maintenance",
  style: "Changed",
  test: "Maintenance",
};

export function releaseChangeFromSubject(subject) {
  const match = /^(\w+)(?:\([^)]+\))?!?: (.+)$/.exec(subject);

  if (!match || !changeTypeByCommitType[match[1]]) {
    throw new Error(`Cannot create release notes from commit: ${subject}`);
  }

  const description = match[2];
  return {
    type: changeTypeByCommitType[match[1]],
    description: `${description.charAt(0).toUpperCase()}${description.slice(1)}`,
  };
}

export function roadmapMajor(roadmapRelease) {
  const match = /^R([0-7])$/.exec(roadmapRelease);
  return match ? Number(match[1]) : null;
}
