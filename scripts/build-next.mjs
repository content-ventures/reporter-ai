import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** One public, non-secret deployment id per build, inherited by every Next build worker. */
export function buildEnvironment(env, makeId = randomUUID) {
  return { ...env, NEXT_DEPLOYMENT_ID: env.NEXT_DEPLOYMENT_ID || `reporter-${makeId()}` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const require = createRequire(import.meta.url);
  const result = spawnSync(process.execPath, [require.resolve('next/dist/bin/next'), 'build', ...process.argv.slice(2)], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: buildEnvironment(process.env),
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
