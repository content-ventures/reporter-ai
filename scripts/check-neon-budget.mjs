import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The Free plan's monthly transfer. After an upgrade, set NEON_TRANSFER_QUOTA_BYTES to the
// plan's included transfer; 0 disables the check.
export const FREE_TRANSFER_BYTES = 5_000_000_000;
export const RELEASE_TRANSFER_SHARE = 0.6;

/** A release must leave room: it stops once the period's transfer passes 60% of the quota. */
export function transferVerdict(project, quota = FREE_TRANSFER_BYTES, share = RELEASE_TRANSFER_SHARE) {
  const used = Number(project?.data_transfer_bytes);
  if (!Number.isFinite(used)) return { ok: false, message: 'Neon did not report this project\'s data transfer.' };
  const gigabytes = value => (value / 1e9).toFixed(2);
  if (quota <= 0) return { ok: true, message: `Transfer ${gigabytes(used)} GB this period; the budget check is disabled.` };
  const ratio = used / quota;
  const message = `Transfer ${gigabytes(used)} GB of ${gigabytes(quota)} GB this period (${Math.round(ratio * 100)}%; releases stop above ${Math.round(share * 100)}%).`;
  return { ok: ratio <= share, message };
}

export async function neonProject({ projectId, apiKey, request = fetch }) {
  const response = await request(`https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}`,
    { headers: { Authorization: `Bearer ${apiKey}`, accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Neon project lookup failed (HTTP ${response.status}).`); }
  return (await response.json()).project;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { NEON_API_KEY: apiKey, NEON_PROJECT_ID: projectId, NEON_TRANSFER_QUOTA_BYTES: configured } = process.env;
  if (!apiKey || !projectId) throw new Error('NEON_API_KEY and NEON_PROJECT_ID are required.');
  const quota = configured?.trim() ? Number(configured) : FREE_TRANSFER_BYTES;
  if (!Number.isFinite(quota) || quota < 0) throw new Error('NEON_TRANSFER_QUOTA_BYTES must be a byte count, or 0 to disable.');
  try {
    const verdict = transferVerdict(await neonProject({ projectId, apiKey }), quota);
    (verdict.ok ? console.log : console.error)(verdict.message);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${verdict.message}\n`);
    if (!verdict.ok) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
