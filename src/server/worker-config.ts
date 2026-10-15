import 'server-only';
import { FlowError } from './errors.ts';

type Environment = Readonly<Record<string, string | undefined>>;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function secureOrLoopback(url: URL) {
  return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname));
}

/** The worker's public base URL, configured per environment instead of registered by heartbeats. */
export function workerUrl(environment: Environment = process.env): string | undefined {
  const raw = environment.REPORTER_WORKER_URL?.trim();
  if (!raw) return undefined;
  let url: URL;
  try { url = new URL(raw); } catch { throw new FlowError('WORKER_CONFIGURATION', 503); }
  if (!secureOrLoopback(url) || url.username || url.password || url.search || url.hash) throw new FlowError('WORKER_CONFIGURATION', 503);
  return url.origin + url.pathname.replace(/\/+$/, '');
}

/** Browser origins allowed to upload directly to the worker and the bucket. */
export function appOrigins(environment: Environment = process.env): string[] {
  const raw = environment.REPORTER_APP_ORIGINS?.trim() || environment.REPORTER_APP_ORIGIN?.trim() || '';
  const origins = raw.split(',').map(entry => entry.trim()).filter(Boolean);
  for (const origin of origins) {
    let url: URL;
    try { url = new URL(origin); } catch { throw new FlowError('UPLOAD_CONFIGURATION', 503); }
    if (url.origin !== origin || !secureOrLoopback(url)) throw new FlowError('UPLOAD_CONFIGURATION', 503);
  }
  return [...new Set(origins)];
}
