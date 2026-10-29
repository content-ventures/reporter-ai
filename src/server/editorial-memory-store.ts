import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { can } from '../domain/permissions.ts';
import type { Capability } from '../domain/permissions.ts';
import { stableStringify } from '../domain/text/hash.ts';
import { transaction } from './database.ts';
import { FlowError, forbiddenError } from './errors.ts';
import { currentReporterContext } from './request-context.ts';
import { reporterDeploymentMode } from './deployment.ts';
import type { Member } from '../domain/workspace.ts';

export type MemoryStoredKind = 'material' | 'evidence' | 'check' | 'decision' | 'policy' | 'selection' | 'use' | 'job' | 'block';
export type MemoryStored<T> = { kind: MemoryStoredKind; id: string; storage_revision: number; doc: T; fingerprint: string | null;
  parent_kind: MemoryStoredKind | null; parent_id: string | null; source_id: string | null; origin_production_id: string | null; seq: number };
export async function memoryGet<T>(client: PoolClient, kind: MemoryStoredKind, id: string, revision?: number): Promise<MemoryStored<T> | null> {
  return (await client.query('SELECT public.reporter_memory_get($1,$2,$3) AS value', [kind, id, revision ?? null])).rows[0].value;
}
export async function memoryPut<T>(client: PoolClient, input: { kind: MemoryStoredKind; id: string; expected: number | null; doc: T;
  sourceId?: string; productionId?: string | null; parentKind?: MemoryStoredKind; parentId?: string; fingerprint?: string }): Promise<MemoryStored<T>> {
  return (await client.query('SELECT public.reporter_memory_put($1::jsonb) AS value', [JSON.stringify(input)])).rows[0].value;
}
export function memoryError(error: unknown): never {
  if (error instanceof FlowError) throw error;
  const database = error as { code?: string; message?: string };
  if (['42501', '25006'].includes(database.code ?? '')) throw new FlowError('FORBIDDEN', 403);
  if (['MEMORY_CONFLICT', 'MEMORY_CURSOR_INVALID'].includes(database.message ?? '')) throw new FlowError(database.message!, 409);
  if (['23503', '23514', '22023', '22P02'].includes(database.code ?? '')) throw new FlowError('INVALID_INPUT', 422);
  throw error;
}
export async function memoryRead<T>(read: (client: PoolClient) => Promise<T>): Promise<T> {
  try { return await transaction('runtime', read); } catch (error) { return memoryError(error); }
}
export async function memoryAuthorizeWrite(client: PoolClient, capability: Extract<Capability, 'library.edit' | 'library.review' | 'pipeline.edit'>) {
  const context = currentReporterContext();
  if (context.view || !can(context.roles, capability)) throw forbiddenError(capability);
  await client.query('SELECT public.reporter_memory_authorize($1)', [capability]);
  if (reporterDeploymentMode() === 'local') {
    const loaded = (await client.query('SELECT public.reporter_ed_load($1::jsonb) AS value', [JSON.stringify({
      write: false, productions: [], parts: [], sources: 'none', runs: 'none', pipelines: false, items: { member: 'all' },
    })])).rows[0].value as { items: { kind: string; doc: Member | null }[] };
    const member = loaded.items.find(item => item.kind === 'member' && item.doc?.personId === context.actor)?.doc;
    if (member && !can(member, capability)) throw forbiddenError(capability);
  }
}
/** Authorization runs before reading a cached response, including an otherwise idempotent retry. */
export async function memoryCommand<T>(operation: string, input: unknown, requestId: string, capability: Extract<Capability, 'library.edit' | 'library.review' | 'pipeline.edit'>,
  authorize: (client: PoolClient) => Promise<void>, write: (client: PoolClient) => Promise<T>): Promise<T> {
  const context = currentReporterContext();
  if (context.view || !can(context.roles, capability)) throw forbiddenError(capability);
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) throw new FlowError('IDEMPOTENCY_KEY_REQUIRED', 422);
  const hash = createHash('sha256').update(stableStringify({ operation, input })).digest('hex');
  try {
    return await transaction('runtime', async client => {
      await memoryAuthorizeWrite(client, capability);
      await authorize(client);
      const receipt = (await client.query('SELECT public.reporter_memory_receipt($1,$2,$3) AS value', [operation, requestId, hash])).rows[0].value as { replayed: boolean; result?: T };
      if (receipt.replayed) {
        await client.query('SELECT public.reporter_memory_authorize($1)', [capability]);
        await authorize(client);
        return receipt.result!;
      }
      const result = await write(client);
      if (result === undefined) throw new FlowError('INTERNAL_ERROR', 500);
      await client.query('SELECT public.reporter_memory_receipt($1,$2,$3,$4::jsonb)', [operation, requestId, hash, JSON.stringify(result)]);
      return result;
    }, randomUUID());
  } catch (error) { return memoryError(error); }
}
