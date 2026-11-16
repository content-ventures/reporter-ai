import 'server-only';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';
import { FlowError } from './errors';
export function publicPageAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && [0, 168].includes(b) || a === 100 && b >= 64 && b <= 127 || a === 198 && [18, 19].includes(b));
  }
  return isIP(address) === 6 && /^[23]/.test(address) && !address.toLowerCase().startsWith('2001:db8:');
}
/** Resolve every redirect, then pin that validated address to the TLS connection. */
export async function publicPage(value: string, signal: AbortSignal) {
  let url: URL;
  try { url = new URL(value); } catch { throw new FlowError('SOURCE_LINK_INVALID', 422); }
  for (let redirect = 0; redirect <= 5; redirect++) {
    if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') throw new FlowError('SOURCE_LINK_INVALID', 422);
    const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true, verbatim: true });
    if (!addresses.length || addresses.some(entry => !publicPageAddress(entry.address))) throw new FlowError('SOURCE_LINK_INVALID', 422);
    const pinned = addresses[0];
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const req = request(url, { signal, family: pinned.family, headers: { 'user-agent': 'ReporterAI/1.0', accept: 'text/html,text/plain;q=0.9' },
        lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
      }, resolve);
      req.once('error', reject); req.end();
    });
    if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
      const location = response.headers.location; response.destroy();
      if (!location || redirect === 5) throw new FlowError('SOURCE_LINK_INVALID', 422);
      url = new URL(location, url); continue;
    }
    if (!response.statusCode || response.statusCode >= 400) { response.destroy(); throw new FlowError('SOURCE_LINK_INVALID', 422); }
    let size = 0; const parts: Buffer[] = [];
    try {
      for await (const part of response) {
        signal.throwIfAborted(); const bytes = Buffer.from(part); size += bytes.byteLength;
        if (size > 2 * 1024 * 1024) throw new FlowError('TEXT_TOO_LARGE', 422);
        parts.push(bytes);
      }
    } finally { response.destroy(); }
    return { text: Buffer.concat(parts).toString('utf8'), type: response.headers['content-type'] ?? '', url: url.toString() };
  }
  throw new FlowError('SOURCE_LINK_INVALID', 422);
}
