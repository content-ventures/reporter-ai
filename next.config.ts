import type { NextConfig } from "next";
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PHASE_PRODUCTION_SERVER } from 'next/constants';

const nextConfig: NextConfig = {
  transpilePackages: ["@content-ventures/design-system"],
  // The local profile selector occupies the same corner as Next's development indicator.
  devIndicators: false,
  // Local input files, database evidence and acceptance builds are runtime data, never release assets.
  outputFileTracingExcludes: {'/*':['./.reporter-local/**/*','./.env*']},
  rewrites: async () => [{ source: '/w/:workspace/:path*',destination: '/:path*' }],
};

export default function config(phase: string): NextConfig {
  if (phase !== PHASE_PRODUCTION_SERVER || process.env.NEXT_DEPLOYMENT_ID) return nextConfig;
  // next build persists the exact id. next start must serve that same deployment, not a new one.
  try {
    const saved = JSON.parse(readFileSync(join(process.cwd(), '.next/required-server-files.json'), 'utf8'));
    const deploymentId = saved.config?.deploymentId;
    return typeof deploymentId === 'string' && deploymentId ? { ...nextConfig, deploymentId } : nextConfig;
  } catch {
    return nextConfig; // Next reports a missing/invalid build through its normal startup checks.
  }
}
