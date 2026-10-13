export type ReporterDeploymentMode = 'local' | 'cloud';

/** Explicit in deployed environments; local remains the development default. */
export function reporterDeploymentMode(): ReporterDeploymentMode {
  const configured = process.env.REPORTER_DEPLOYMENT_MODE?.trim();
  if (configured === 'local' || configured === 'cloud') return configured;
  if (process.env.REPORTER_LOCAL_MODE === 'true') return 'local';
  return process.env.NODE_ENV === 'production' ? 'cloud' : 'local';
}
