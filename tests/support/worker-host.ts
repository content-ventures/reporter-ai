import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Serves a Neon Function `fetch` handler over loopback HTTP. The runtime's waitUntil is
 * emulated through the context @neon/functions reads, so tests can await background drains.
 */
export async function startWorkerHost(handler: { fetch(request: Request): Promise<Response> }) {
  const pending = new Set<Promise<unknown>>();
  globalThis.NEON_REQUEST_CONTEXT = { waitUntil: promise => {
    pending.add(promise);
    void promise.finally(() => pending.delete(promise)).catch(() => {});
  } };
  const server = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk as Buffer);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    const method = incoming.method ?? 'GET';
    const request = new Request(`${url}${incoming.url ?? '/'}`, { method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : Buffer.concat(chunks) });
    try {
      const response = await handler.fetch(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { outgoing.writeHead(500); outgoing.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    /** Resolves once every background drain started so far, and any it chained, has settled. */
    idle: async () => { while (pending.size) await Promise.allSettled([...pending]); },
    stop: async () => {
      globalThis.NEON_REQUEST_CONTEXT = undefined;
      await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); });
    },
  };
}
