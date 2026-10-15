import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKER_TRIGGERS, scheduleTooFrequent } from './lib/worker-triggers.mjs';

/**
 * Differences between a branch's live triggers (Neon API shape) and neon.ts. An undeclared
 * enabled trigger, a schedule faster than hourly or a missing declared trigger stops a release.
 */
export function triggerProblems(deployed, declared = WORKER_TRIGGERS) {
  const problems = [];
  const live = new Map(deployed.map(trigger => [trigger.name, trigger]));
  for (const trigger of deployed) {
    if (!trigger.enabled) continue;
    if (trigger.type === 'schedule' && scheduleTooFrequent(trigger.schedule?.cron)) {
      problems.push(`${trigger.name} fires more often than hourly (${trigger.schedule?.cron})`);
    }
    const expected = declared[trigger.name];
    if (!expected) { problems.push(`${trigger.name} is enabled but not declared in neon.ts`); continue; }
    const actual = trigger.type === 'schedule'
      ? { type: trigger.type, function: trigger.function_slug, functionPath: trigger.function_path, cron: trigger.schedule?.cron }
      : { type: trigger.type, function: trigger.function_slug, functionPath: trigger.function_path,
        bucket: trigger.storage_object_created?.bucket_name, prefix: trigger.storage_object_created?.prefix };
    const differing = Object.keys(actual).filter(key => actual[key] !== expected[key]);
    if (differing.length) problems.push(`${trigger.name} differs from neon.ts in ${differing.join(', ')}`);
  }
  for (const [name, expected] of Object.entries(declared)) {
    if (expected.enabled && !live.get(name)?.enabled) problems.push(`${name} is declared but not deployed and enabled`);
  }
  return problems;
}

export async function branchTriggers({ projectId, branchId, apiKey, request = fetch }) {
  const response = await request(`https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/triggers`,
    { headers: { Authorization: `Bearer ${apiKey}`, accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Neon trigger listing failed (HTTP ${response.status}).`); }
  return (await response.json()).triggers ?? [];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { NEON_API_KEY: apiKey, NEON_PROJECT_ID: projectId, NEON_BRANCH_ID: branchId } = process.env;
  if (!apiKey || !projectId || !branchId) throw new Error('NEON_API_KEY, NEON_PROJECT_ID and NEON_BRANCH_ID are required.');
  const triggers = await branchTriggers({ projectId, branchId, apiKey });
  for (const trigger of triggers) console.log(`${trigger.enabled ? 'enabled ' : 'disabled'} ${trigger.name} ${trigger.schedule?.cron ?? trigger.storage_object_created?.prefix ?? ''}`);
  const problems = triggerProblems(triggers);
  if (problems.length) { console.error(`Worker triggers are unsafe:\n- ${problems.join('\n- ')}`); process.exitCode = 1; }
  else console.log('Worker triggers match neon.ts and no schedule fires more often than hourly.');
}
