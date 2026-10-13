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

const RELEASE_CHANGE_TYPES = new Set(["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"]);

/**
 * The "Em preparação" block of Novidades (`history.upcoming`): the roadmap release being built,
 * announced from data while the version stays put (PLAN P14). It must be the current or the next
 * roadmap release, must not be released already, carries no version or date, and lists at least
 * one described change of a known type.
 */
export function upcomingViolations(history) {
  const upcoming = history.upcoming;
  if (upcoming === undefined) return [];
  const violations = [];
  const current = roadmapMajor(history.currentRoadmapRelease);
  const target = roadmapMajor(upcoming.roadmapRelease);

  if (target === null || current === null || (target !== current && target !== current + 1)) {
    violations.push(`upcoming ${upcoming.roadmapRelease} must be the current (${history.currentRoadmapRelease}) or the next roadmap release`);
  }
  if (target !== null && target > (current ?? 0) && history.releases.some((release) => release.roadmapRelease === upcoming.roadmapRelease)) {
    violations.push(`upcoming ${upcoming.roadmapRelease} is already released; move it to the release history`);
  }
  if ("version" in upcoming || "date" in upcoming) {
    violations.push("upcoming has no version or date until release:prepare ships it");
  }
  if (typeof upcoming.title !== "string" || !upcoming.title.trim() || typeof upcoming.summary !== "string" || !upcoming.summary.trim()) {
    violations.push("upcoming requires a title and a summary");
  }
  if (!Array.isArray(upcoming.changes) || upcoming.changes.length === 0) {
    violations.push("upcoming requires at least one described change");
  } else {
    for (const change of upcoming.changes) {
      if (!RELEASE_CHANGE_TYPES.has(change?.type) || typeof change?.description !== "string" || !change.description.trim()) {
        violations.push(`upcoming change must have a known type and a description: ${JSON.stringify(change)}`);
      }
    }
  }
  return violations;
}

/**
 * The roadmap release the build shows (`CURRENT_RELEASE`) must be the released one or the next
 * one; when it is the next one, Novidades must announce it in `upcoming`.
 */
export function buildReleaseViolations(history, buildRelease) {
  const current = roadmapMajor(history.currentRoadmapRelease);
  const shown = roadmapMajor(buildRelease);
  if (shown === null || current === null) return [`unknown roadmap release ${buildRelease}`];
  if (shown === current) return [];
  if (shown !== current + 1) return [`the build shows ${buildRelease}, but the history is at ${history.currentRoadmapRelease}`];
  return history.upcoming?.roadmapRelease === buildRelease ? [] : [`the build shows ${buildRelease}; announce it in release-history "upcoming"`];
}
