import 'server-only';
import { createNeonAuth, type NeonAuth } from '@neondatabase/auth/next/server';

let singleton: NeonAuth | undefined;

function required(name: 'NEON_AUTH_BASE_URL' | 'NEON_AUTH_COOKIE_SECRET') {
  const value = process.env[name]?.trim();
  if (!value) throw new Error('AUTH_CONFIGURATION');
  return value;
}

export function reporterAuth() {
  return singleton ??= createNeonAuth({
    baseUrl: required('NEON_AUTH_BASE_URL'),
    cookies: { secret: required('NEON_AUTH_COOKIE_SECRET'),sessionDataTtl: 300 },
    logLevel: process.env.NODE_ENV === 'production' ? 'warn' : 'error',
  });
}

export async function reporterIdentity() {
  const { data, error } = await reporterAuth().getSession();
  if (error || !data?.user) return null;
  return {
    subject: String(data.user.id),
    email: String(data.user.email ?? '').trim().toLowerCase(),
    name: String(data.user.name ?? data.user.email ?? 'Usuário').trim(),
    image: typeof data.user.image === 'string' ? data.user.image : undefined,
    emailVerified: data.user.emailVerified === true,
  };
}
