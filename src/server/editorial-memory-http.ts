import 'server-only';
import { parseMemoryQuery } from './editorial-memory-input.ts';
import { queryEditorialMemory, readMemoryPolicy } from './editorial-memory-query.ts';
import { FlowError } from './errors.ts';

/** The module stays unavailable until its controlled acceptance enables the server ceiling. */
export async function handleEditorialMemory(request: Request, path: string[]): Promise<Response> {
  if (process.env.REPORTER_MEMORY_MODE !== 'on') throw new FlowError('NOT_FOUND', 404);
  if (request.method === 'GET' && path.length === 0) return Response.json(await queryEditorialMemory(parseMemoryQuery(new URL(request.url).searchParams)),
    { headers: { 'Cache-Control': 'private, no-store' } });
  if (request.method === 'GET' && path.join('/') === 'policy') return Response.json(await readMemoryPolicy(), { headers: { 'Cache-Control': 'private, no-store' } });
  throw new FlowError('NOT_FOUND', 404);
}
