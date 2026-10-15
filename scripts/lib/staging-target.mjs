/** Acceptance writes synthetic people and productions, so it runs only on the staging project. */

/**
 * Refuses anything but the persistent staging project: the environment must say so explicitly
 * and the branch must not be protected, as production branches are.
 */
export async function assertStagingTarget(environment = process.env, request = fetch) {
  if (environment.REPORTER_ACCEPTANCE_TARGET !== 'staging') {
    throw new Error('Acceptance writes only to staging: REPORTER_ACCEPTANCE_TARGET=staging belongs on the staging environment alone.');
  }
  for (const name of ['NEON_API_KEY', 'NEON_PROJECT_ID', 'NEON_BRANCH_ID']) if (!environment[name]) throw new Error(`Missing ${name} for staging acceptance.`);
  const response = await request(`https://console.neon.tech/api/v2/projects/${encodeURIComponent(environment.NEON_PROJECT_ID)}/branches/${encodeURIComponent(environment.NEON_BRANCH_ID)}`,
    { headers: { Authorization: `Bearer ${environment.NEON_API_KEY}`, accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Cannot verify the staging branch (HTTP ${response.status}).`); }
  const { branch } = await response.json();
  if (!branch || branch.protected) throw new Error('Acceptance refuses a protected branch: production branches are protected.');
  return branch;
}

/** The staging app origin uploads come from; the staging bucket's CORS allows exactly these. */
export function acceptanceOrigin(environment = process.env) {
  const origin = (environment.REPORTER_APP_ORIGINS ?? '').split(',').map(entry => entry.trim()).find(Boolean);
  if (!origin) throw new Error('REPORTER_APP_ORIGINS must list the staging app origin.');
  return new URL(origin).origin;
}
