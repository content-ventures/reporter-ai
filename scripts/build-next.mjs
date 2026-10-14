import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import packageJson from '../package.json' with { type: 'json' };
import { deploymentSourceViolation } from './lib/deployment-source.mjs';

/** One public, non-secret deployment id per build, inherited by every Next build worker. */
export function buildEnvironment(env, makeId = randomUUID) {
  return { ...env, NEXT_DEPLOYMENT_ID: env.NEXT_DEPLOYMENT_ID || `reporter-${makeId()}` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const deploymentViolation = deploymentSourceViolation({
    environment: process.env.VERCEL_ENV,
    commitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE,
    version: packageJson.version,
  });

  if (deploymentViolation) {
    console.error(`Deployment policy failed: ${deploymentViolation}`);
    process.exit(1);
  }

  const require = createRequire(import.meta.url);
  const result = spawnSync(process.execPath, [require.resolve('next/dist/bin/next'), 'build', ...process.argv.slice(2)], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: buildEnvironment(process.env),
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
