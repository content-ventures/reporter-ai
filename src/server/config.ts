import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import type { TextProvider } from '../domain/pipeline.ts';
import { reporterDeploymentMode } from './deployment.ts';

loadEnvConfig(process.cwd(), true, { info() {}, error() {} });

export function assertLocalMode() {
  // A local `next start` is allowed; HTTP separately enforces loopback and same origin.
  if (process.env.REPORTER_LOCAL_MODE !== "true" || (process.env.NODE_ENV === 'production' && process.env.REPORTER_ALLOW_LOCAL_BUILD !== 'true')) {
    throw new Error("LOCAL_MODE_DISABLED");
  }
}

export function cloudDatabaseUrl(role: "runtime" | "worker") {
  if (reporterDeploymentMode() !== 'cloud') throw new Error('CLOUD_MODE_DISABLED');
  const name = role === 'runtime' ? 'REPORTER_DATABASE_URL' : 'REPORTER_WORKER_DATABASE_URL';
  const value = process.env[name]?.trim();
  if (value) return value;
  const template = process.env.DATABASE_URL?.trim();
  const password = process.env[role === 'runtime' ? 'REPORTER_RUNTIME_PASSWORD' : 'REPORTER_WORKER_PASSWORD']?.trim();
  if (!template || !password) throw new Error('DATABASE_CONFIGURATION');
  const url = new URL(template);
  url.username = 'reporter_' + role;
  url.password = password;
  url.searchParams.set('sslmode','verify-full');
  return url.toString();
}

export function cloudPortalId() {
  const value = process.env.REPORTER_DEFAULT_PORTAL_ID?.trim() || '10000000-0000-0000-0000-000000000101';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('DATABASE_CONFIGURATION');
  }
  return value;
}

export function databasePassword(role: "runtime" | "worker") {
  const key = role === "runtime" ? "REPORTER_RUNTIME_PASSWORD" : "REPORTER_WORKER_PASSWORD";
  // Local Docker credentials have their own ignored file. Cloud credentials may coexist in
  // `.env.local` while configuring Vercel, but must never be tried against the local container.
  const source = readFileSync(join(process.cwd(), ".env.reporter-db"), "utf8");
  const value = source.split("\n").find(line => line.startsWith(key + "="))?.slice(key.length + 1).trim();
  if (!value || value.startsWith("replace-")) throw new Error("DATABASE_CONFIGURATION");
  return value;
}

export function groqKey() {
  const value = process.env.GROQ_API_KEY?.trim();
  if (!value) throw new Error("GROQ_KEY_MISSING");
  return value;
}

/** Accept the user's existing names; credentials never enter a browser projection. */
export function providerConfigured(provider: TextProvider) {
  return Boolean(providerCredential(provider));
}
function providerCredential(provider: TextProvider) {
  const names = provider === 'openai' ? ['OPENAI_API_KEY', 'OPEN_AI_API_KEY']
    : provider === 'anthropic' ? ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'] : ['GROQ_API_KEY'];
  return names.map(name => process.env[name]?.trim()).find(Boolean);
}
export function providerKey(provider: TextProvider) {
  const value = providerCredential(provider);
  if (!value) throw new Error(provider.toUpperCase() + '_KEY_MISSING');
  return value;
}

export const localContext = {
  tenant: "00000000-0000-0000-0000-000000000001",
  portal: "00000000-0000-0000-0000-000000000101",
  actor: "00000000-0000-0000-0000-000000000031",
  workspaceName: 'Repórter AI',
  workspaceSlug: 'reporter-ai-local',
  name: 'Operador local',
  email: 'operator@reporter.local.invalid',
  roles: ['admin', 'editor', 'approver', 'creative_reviewer'] as const,
};
