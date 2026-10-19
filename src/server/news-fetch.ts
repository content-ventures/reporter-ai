import 'server-only';
import { lookup as dnsLookup } from 'node:dns/promises';
import { NEWS_LIMITS } from '../domain/news-intake.ts';
import { FlowError } from './errors.ts';
import { privateAddress } from './public-address.ts';

/** What a news source answered: the text, or "unchanged" (304) when the cache validators still hold. */
export type FetchedText =
  | { status: 200; url: string; text: string; contentType: string; etag?: string; lastModified?: string }
  | { status: 304; url: string };

export type FetchOptions = {
  maxBytes: number;
  accept: string;
  etag?: string;
  lastModified?: string;
  signal?: AbortSignal;
};

export type FetchServices = {
  fetch: typeof fetch;
  lookup: (host: string) => Promise<{ address: string }[]>;
};

const USER_AGENT = 'Mozilla/5.0 (compatible; ReporterIA/1.0; leitor de notícias)';

const services: FetchServices = {
  fetch: (input, init) => fetch(input, init),
  lookup: (host) => dnsLookup(host, { all: true, verbatim: true }),
};

/** Public http(s) on the standard ports only: a feed address never reaches the private network. */
async function publicUrl(value: string, lookup: FetchServices['lookup']): Promise<URL> {
  let url: URL;
  try { url = new URL(value); } catch { throw new FlowError('NEWS_URL_INVALID', 422); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) {
    throw new FlowError('NEWS_URL_INVALID', 422);
  }
  const addresses = await lookup(url.hostname).catch(() => []);
  if (!addresses.length) throw new FlowError('NEWS_UNREACHABLE', 422);
  if (addresses.some((entry) => privateAddress(entry.address))) throw new FlowError('NEWS_ADDRESS_BLOCKED', 422);
  return url;
}

/** The charset the response declares, else the one the document declares, else UTF-8. */
export function charsetOf(contentType: string, head: Uint8Array): string {
  const declared = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  const sniffed = declared ?? (() => {
    const start = new TextDecoder('latin1').decode(head.subarray(0, 2048));
    return /<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(start)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(start)?.[1];
  })();
  const name = (sniffed ?? 'utf-8').toLowerCase();
  try { new TextDecoder(name); return name; } catch { return 'utf-8'; }
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > maxBytes) { await response.body?.cancel().catch(() => {}); throw new FlowError('NEWS_TOO_LARGE', 422); }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel().catch(() => {}); throw new FlowError('NEWS_TOO_LARGE', 422); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/**
 * GET with every hop checked (at most five redirects), a 15-second budget, a byte cap and the
 * source's cache validators. Failures are bounded codes a source can keep.
 */
export async function fetchText(source: string, options: FetchOptions, deps: FetchServices = services): Promise<FetchedText> {
  const timeout = AbortSignal.timeout(NEWS_LIMITS.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const headers: Record<string, string> = { 'user-agent': USER_AGENT, accept: options.accept, 'accept-language': 'pt-BR,pt;q=0.9,en;q=0.5' };
  if (options.etag) headers['if-none-match'] = options.etag;
  if (options.lastModified) headers['if-modified-since'] = options.lastModified;
  try {
    let url = await publicUrl(source, deps.lookup);
    for (let hop = 0; hop <= 5; hop++) {
      const response = await deps.fetch(url, { redirect: 'manual', signal, headers });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => {});
        if (!location || hop === 5) throw new FlowError('NEWS_UNREACHABLE', 422);
        url = await publicUrl(new URL(location, url).toString(), deps.lookup);
        continue;
      }
      if (response.status === 304) { await response.body?.cancel().catch(() => {}); return { status: 304, url: url.toString() }; }
      if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new FlowError(`HTTP_${response.status}`, 422); }
      const contentType = response.headers.get('content-type') ?? '';
      const bytes = await readCapped(response, options.maxBytes);
      const text = new TextDecoder(charsetOf(contentType, bytes)).decode(bytes);
      const etag = response.headers.get('etag')?.slice(0, 500) || undefined;
      const lastModified = response.headers.get('last-modified')?.slice(0, 100) || undefined;
      return { status: 200, url: url.toString(), text, contentType, ...(etag ? { etag } : {}), ...(lastModified ? { lastModified } : {}) };
    }
    throw new FlowError('NEWS_UNREACHABLE', 422);
  } catch (error) {
    if (error instanceof FlowError) throw error;
    if (timeout.aborted) throw new FlowError('NEWS_TIMEOUT', 422);
    if (options.signal?.aborted) throw error;
    throw new FlowError('NEWS_UNREACHABLE', 422);
  }
}
