import { join } from 'node:path';

export function storageRootPath(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  cwd = process.cwd(),
) {
  const ephemeralRuntime = environment.REPORTER_FUNCTION_RUNTIME === 'true' || environment.VERCEL === '1';
  return ephemeralRuntime ? join('/tmp', 'reporter-ai') : join(cwd, '.reporter-local');
}
