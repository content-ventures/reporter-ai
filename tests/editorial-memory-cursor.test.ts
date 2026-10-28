import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeMemoryCursor, encodeMemoryCursor } from '../src/server/editorial-memory-cursor.ts';
import type { MemoryCursorContext } from '../src/server/editorial-memory-cursor.ts';
import type { MemoryQuery } from '../src/domain/editorial-memory.ts';
import { FlowError } from '../src/server/errors.ts';

const key = 'synthetic-cursor-signing-key-not-a-credential';
const context: MemoryCursorContext = { tenant: 'tenant', workspace: 'workspace', actor: 'member', visibility: 'revision-1' };
const query: MemoryQuery = { kind: 'statistic', topics: ['Beta', 'Alfa'], minConfidence: 85, unused: true };
const position = { snapshot: '9007199254740993', position: { key: '2026-10-28T12:00:00.123456Z', id: 'last-evidence' } };
const now = 1_790_000_000_000;
const isInvalid = (error: unknown) => error instanceof FlowError && error.code === 'MEMORY_CURSOR_INVALID' && error.status === 409;

test('signed cursors retain PostgreSQL precision and normalize default/filter ordering without reading or writing a database', () => {
  const token = encodeMemoryCursor(position, query, context, key, now);
  assert.deepEqual(decodeMemoryCursor(token, { ...query, cursor: token, topics: ['Alfa', 'Beta', 'Alfa'], limit: 25, sort: 'newest', useStage: 'inserted' }, context, key, now + 1), position);
});

test('a cursor is bound to its actual tenant, workspace, actor, visibility epoch and complete query', () => {
  const token = encodeMemoryCursor(position, query, context, key, now);
  for (const changed of [{ ...context, tenant: 'other' }, { ...context, workspace: 'other' }, { ...context, actor: 'other' }, { ...context, visibility: 'revision-2' }])
    assert.throws(() => decodeMemoryCursor(token, query, changed, key, now), isInvalid);
  for (const changed of [{ ...query, minConfidence: 90 }, { ...query, unused: false }, { ...query, sort: 'usage' as const }, { ...query, limit: 50 }])
    assert.throws(() => decodeMemoryCursor(token, changed, context, key, now), isInvalid);
});

test('tampering, rotation, malformed input and expired cursors are explicit conflicts', () => {
  const token = encodeMemoryCursor(position, query, context, key, now);
  const [body, signature] = token.split('.');
  const altered = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); altered.snapshot = '999999';
  for (const candidate of ['', `${body}.`, `${body}.${signature}.extra`, `${Buffer.from(JSON.stringify(altered)).toString('base64url')}.${signature}`, 'x'.repeat(4097)])
    assert.throws(() => decodeMemoryCursor(candidate, query, context, key, now), isInvalid);
  assert.throws(() => decodeMemoryCursor(token, query, context, `${key}-rotated`, now), isInvalid);
  assert.throws(() => decodeMemoryCursor(token, query, context, key, now + 31 * 60_000), isInvalid);
});

test('out-of-range snapshots and short signing keys cannot create valid page tokens', () => {
  for (const snapshot of ['-1', '01', '1.5', '9223372036854775808'])
    assert.throws(() => encodeMemoryCursor({ ...position, snapshot }, query, context, key, now));
  assert.throws(() => encodeMemoryCursor(position, query, context, 'short', now), (error: unknown) =>
    error instanceof FlowError && error.code === 'MEMORY_CURSOR_CONFIGURATION');
});
