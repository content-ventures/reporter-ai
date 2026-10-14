import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import { deploymentSourceViolation } from "./lib/deployment-source.mjs";

/** Vercel's ignore step returns 0 to skip a build and 1 to continue. */
export function ignoreBuildStepExitCode({ environment, commitMessage, version }) {
  return deploymentSourceViolation({ environment, commitMessage, version }) ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violation = deploymentSourceViolation({
    environment: process.env.VERCEL_ENV,
    commitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE,
    version: packageJson.version,
  });

  if (violation) {
    console.log(`Skipping production deployment before build: ${violation}`);
  } else {
    console.log("Deployment source accepted; continuing with the build.");
  }

  process.exitCode = violation ? 0 : 1;
}
