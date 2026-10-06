import { spawnSync } from "node:child_process";

export function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(detail || `${command} exited with status ${result.status}`);
  }

  return result.stdout.trim();
}

export function fail(message) {
  console.error(`Harness check failed: ${message}`);
  process.exit(1);
}
