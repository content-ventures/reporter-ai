import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function localDevelopmentEnvironment(environment = process.env) {
  return {
    ...environment,
    REPORTER_DEPLOYMENT_MODE: 'local',
    REPORTER_LOCAL_MODE: 'true',
  };
}

export function nextDevArguments(port = '3002') {
  return [resolve('node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', port];
}

async function main() {
  const child = spawn(process.execPath, nextDevArguments(), {
    env: localDevelopmentEnvironment(),
    stdio: 'inherit',
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => child.kill(signal));
  }
  child.once('error', error => {
    console.error(`Could not start the local Reporter app: ${error.message}`);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
