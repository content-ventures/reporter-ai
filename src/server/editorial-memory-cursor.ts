import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { MemoryQuery } from '../domain/editorial-memory.ts';
import { stableStringify } from '../domain/text/hash.ts';
import { FlowError } from './errors.ts';
import { memoryQuerySchema, memoryResourceBindingSchema } from './editorial-memory-input.ts';
type CursorQuery = MemoryQuery | z.infer<typeof memoryResourceBindingSchema>;

/** Authorization changes invalidate a page sequence instead of silently mixing visibility states. */
export type MemoryCursorContext = { tenant: string; workspace: string; actor: string; visibility: string };
const snapshot = z.string().regex(/^(?:0|[1-9]\d{0,18})$/)
  .refine(value => /^(?:0|[1-9]\d{0,18})$/.test(value) && BigInt(value) <= BigInt('9223372036854775807'));
const cursorSchema = z.object({
  version: z.literal(1), tenant: z.string().min(1).max(128), workspace: z.string().min(1).max(128), actor: z.string().min(1).max(128),
  visibility: z.string().min(1).max(128), query: z.string().regex(/^[a-f0-9]{64}$/), snapshot,
  position: z.object({ key: z.string().max(240), id: z.string().min(1).max(128) }).strict(), expiresAt: z.number().int().positive(),
}).strict();
export type MemoryCursorPosition = Pick<z.infer<typeof cursorSchema>, 'snapshot' | 'position'>;
const TTL_MS = 30 * 60 * 1000;
function mac(key: string, purpose: string, value: string): Buffer {
  if (key.length < 24) throw new FlowError('MEMORY_CURSOR_CONFIGURATION', 503);
  return createHmac('sha256', key).update(`reporter-memory-${purpose}-v1\0${value}`).digest();
}
function queryIdentity(query: CursorQuery, key: string): string {
  if ('resource' in query) return mac(key, 'query', stableStringify(memoryResourceBindingSchema.parse(query))).toString('hex');
  const normalized = memoryQuerySchema.parse(query);
  return mac(key, 'query', stableStringify({ ...normalized, cursor: undefined,
    topics: normalized.topics ? [...new Set(normalized.topics)].sort() : undefined })).toString('hex');
}
/** The server provides the key and context; neither can be selected by URL or JSON input. */
export function encodeMemoryCursor(position: MemoryCursorPosition, query: CursorQuery, context: MemoryCursorContext, key: string, now: number): string {
  const payload = cursorSchema.parse({ ...position, ...context, version: 1, query: queryIdentity(query, key), expiresAt: now + TTL_MS });
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${mac(key, 'cursor', body).toString('base64url')}`;
}
export function decodeMemoryCursor(value: string, query: CursorQuery, context: MemoryCursorContext, key: string, now: number): MemoryCursorPosition {
  const invalid = () => new FlowError('MEMORY_CURSOR_INVALID', 409);
  if (value.length > 4096) throw invalid();
  const [body, signature, ...rest] = value.split('.');
  if (!body || !signature || rest.length || !/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) throw invalid();
  const actual = Buffer.from(signature, 'base64url'), expected = mac(key, 'cursor', body);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalid();
  let payload: z.infer<typeof cursorSchema>;
  try { payload = cursorSchema.parse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))); }
  catch { throw invalid(); }
  if (payload.expiresAt <= now || payload.query !== queryIdentity(query, key)
    || Object.entries(context).some(([name, current]) => payload[name as keyof MemoryCursorContext] !== current)) throw invalid();
  return { snapshot: payload.snapshot, position: payload.position };
}
