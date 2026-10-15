import { build } from 'esbuild';
import { defineConfig } from '@neon/config/v1';
import type { FunctionBundler, FunctionDef } from '@neon/config/v1';
import { nativeMediaAssets } from './scripts/native-media-assets.mjs';

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required to deploy Reporter AI Functions`);
  return value;
};
const requiredAny = (...names: string[]) => {
  const value = names.map(name => process.env[name]?.trim()).find(Boolean);
  if (!value) throw new Error(`${names.join(' or ')} is required to deploy Reporter AI Functions`);
  return value;
};
// Known once the function exists on the branch: `neon env pull` exposes it for later deploys.
const workerBaseUrl = () => process.env.REPORTER_WORKER_URL?.trim() || process.env.NEON_FUNCTION_REPORTERWORKER_BASE_URL?.trim();
const workerDatabaseUrl = () => {
  const url = new URL(required('DATABASE_URL'));
  url.username = 'reporter_worker';
  url.password = required('REPORTER_WORKER_PASSWORD');
  url.searchParams.set('sslmode','verify-full');
  return url.toString();
};

export const bundleWorker: FunctionBundler = async fn => {
  const { traceNativePackages } = await import('@neon/config-runtime/v1');
  const result = await build({
    entryPoints: [fn.source],
    bundle: true,
    minify: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    write: false,
    outfile: 'index.mjs',
    conditions: ['react-server', 'node', 'import'],
    external: ['pg', 'sharp'],
    banner: {
      js: "import{createRequire}from'node:module';import{fileURLToPath}from'node:url';import{dirname}from'node:path';const require=createRequire(import.meta.url);const __filename=fileURLToPath(import.meta.url);const __dirname=dirname(__filename);",
    },
  });
  const staged = await traceNativePackages({
    slug: fn.slug,
    packages: ['pg', 'sharp'],
    projectDir: process.cwd(),
  });

  for (const warning of staged.warnings) {
    console.warn(warning);
  }

  return {
    'index.mjs': result.outputFiles[0].contents,
    ...staged.entries,
    ...await nativeMediaAssets(),
  };
};

const functions = {
  reporterworker: {
    name: 'Reporter AI editorial worker',
    source: './functions/reporter-worker.ts',
    env: {
      REPORTER_DEPLOYMENT_MODE: 'cloud',
      REPORTER_FUNCTION_RUNTIME: 'true',
      REPORTER_SOURCE_COMMIT: process.env.GITHUB_SHA || 'local-validation',
      REPORTER_DEPLOYMENT_ACTOR: process.env.GITHUB_ACTOR || 'local-validation',
      REPORTER_DEFAULT_PORTAL_ID: '10000000-0000-0000-0000-000000000101',
      REPORTER_APP_ORIGINS: required('REPORTER_APP_ORIGINS'),
      ...(workerBaseUrl()?{REPORTER_WORKER_URL:workerBaseUrl()}:{}),
      REPORTER_WORKER_DATABASE_URL: workerDatabaseUrl(),
      REPORTER_WORKER_PASSWORD: required('REPORTER_WORKER_PASSWORD'),
      GROQ_API_KEY: required('GROQ_API_KEY'),
      OPENAI_API_KEY: requiredAny('OPENAI_API_KEY','OPEN_AI_API_KEY'),
      ANTHROPIC_API_KEY: requiredAny('ANTHROPIC_API_KEY','CLAUDE_API_KEY'),
      PIXABAY_API_KEY: required('PIXABAY_API_KEY'),
    },
    bundler: bundleWorker,
  },
} satisfies Record<string,FunctionDef>;

export default defineConfig({
  auth: true,
  buckets: {
    'reporter-source-media': {},
  },
  functions,
  triggers: {
    // Hourly safety sweep. The app wakes the worker on demand, so this only catches work
    // whose wake-up was lost. The legacy name is kept on purpose: triggers are matched by
    // name, and a renamed trigger would leave the old every-minute schedule firing.
    'reporter-editorial-every-minute': {
      type: 'schedule',function: 'reporterworker',cron: '0 * * * *',functionPath: '/triggers/schedule',enabled: true,
    },
    'reporter-source-uploaded': {
      type: 'storage_object_created',function: 'reporterworker',bucket: 'reporter-source-media',
      prefix: 'incoming/',functionPath: '/triggers/storage',enabled: true,
    },
  },
});
