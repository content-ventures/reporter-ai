import 'server-only';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { FlowError } from './errors.ts';

/** Plain HTTP is accepted only from a loopback storage endpoint (the local cloud rehearsal). */
function loopbackStorage(target: URL) {
  const configured = process.env.AWS_ENDPOINT_URL_S3?.trim();
  if (!configured) return false;
  const storage = new URL(configured);
  return storage.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(storage.hostname) && storage.origin === target.origin;
}

/** A private loopback bridge lets Node own DNS and verified TLS. FFmpeg reads
 * byte ranges without downloading the original into memory or local storage. */
export async function withCloudMediaSource<T>(source: string, signal: AbortSignal, operation: (url: string) => Promise<T>): Promise<T> {
  const target = new URL(source);
  if (target.protocol !== 'https:' && !loopbackStorage(target) || target.username || target.password) throw new FlowError('SOURCE_UNAVAILABLE', 422);
  const path = '/' + randomUUID();
  const server = createServer(async (request, response) => {
    if (request.url !== path || !['GET', 'HEAD'].includes(request.method ?? '')) { response.writeHead(404).end(); return; }
    const range = request.headers.range;
    if (range && !/^bytes=\d+-\d*$/.test(range)) { response.writeHead(416).end(); return; }
    const controller = new AbortController();
    response.once('close', () => controller.abort());
    try {
      const upstream = await fetch(target, { method: request.method, redirect: 'error',
        headers: range ? { Range: range } : {},
        signal: AbortSignal.any([signal, controller.signal, AbortSignal.timeout(120_000)]),
      });
      if (![200, 206, 416].includes(upstream.status)) { await upstream.body?.cancel(); throw new FlowError('SOURCE_UNAVAILABLE', 422); }
      const headers: Record<string, string> = {};
      for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        const value = upstream.headers.get(name); if (value) headers[name] = value;
      }
      response.writeHead(upstream.status, headers);
      if (!upstream.body) response.end();
      else await pipeline(Readable.fromWeb(upstream.body as never), response, { signal: controller.signal });
    } catch {
      if (!response.headersSent) response.writeHead(502).end(); else response.destroy();
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new FlowError('SOURCE_UNAVAILABLE', 422);
  try { return await operation(`http://127.0.0.1:${address.port}${path}`); }
  finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
