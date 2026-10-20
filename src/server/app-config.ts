import 'server-only';
import { createHash } from 'node:crypto';
import packageJson from '../../package.json' with { type: 'json' };
import { reporterDeploymentMode } from './deployment.ts';

type Environment = Readonly<Record<string, string | undefined>>;
const present = (environment: Environment, ...names: string[]) => names.some(name => Boolean(environment[name]?.trim()));

/** Which settings a cloud deployment needs, each reported only as present or missing. */
export function appConfiguration(environment: Environment = process.env) {
  return {
    database: present(environment, 'REPORTER_DATABASE_URL') || present(environment, 'DATABASE_URL') && present(environment, 'REPORTER_RUNTIME_PASSWORD'),
    auth: present(environment, 'NEON_AUTH_BASE_URL') && present(environment, 'NEON_AUTH_COOKIE_SECRET'),
    worker: present(environment, 'REPORTER_WORKER_URL'),
    workerSecret: present(environment, 'REPORTER_WORKER_PASSWORD'),
    groq: present(environment, 'GROQ_API_KEY'),
    openai: present(environment, 'OPENAI_API_KEY', 'OPEN_AI_API_KEY'),
    anthropic: present(environment, 'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'),
    pixabay: present(environment, 'PIXABAY_API_KEY'),
    tavily: present(environment, 'TAVILY_API_KEY'),
  };
}

/** Which worker the app wakes, comparable with a worker URL without revealing it. */
export function workerFingerprint(url: string | undefined) {
  if (!url?.trim()) return null;
  try { return createHash('sha256').update(new URL(url.trim()).origin).digest('hex').slice(0, 16); }
  catch { return 'invalid'; }
}

/**
 * The public release probe: version, source commit and readiness, without touching the
 * database or revealing any value. A release waits for its version here before passing.
 */
export function appHealth(environment: Environment = process.env) {
  const configured = appConfiguration(environment);
  const mode = reporterDeploymentMode();
  return {
    service: 'reporter-ai', version: packageJson.version, mode,
    commit: environment.VERCEL_GIT_COMMIT_SHA?.trim() || 'unknown',
    environment: environment.VERCEL_ENV?.trim() || 'local',
    ready: mode !== 'cloud' || Object.values(configured).every(Boolean),
    configured, worker: workerFingerprint(environment.REPORTER_WORKER_URL),
  };
}
