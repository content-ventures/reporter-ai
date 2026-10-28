import assert from 'node:assert/strict';
import { test } from 'node:test';
import { articleHash, paragraphBlock } from './article.ts';
import { memoryUsedArticle, type MemoryVersionUse } from './editorial-memory-reading.ts';

const body = { type: 'article' as const, title: 'Frozen synthetic article', blocks: [paragraphBlock('b1', 'Foram atendidas cerca de 240 pessoas em 2025.')] };
const hash = articleHash(body), article = { kind: 'version' as const, pieceId: 'piece', versionId: 'v1', number: 1, hash };
const use: MemoryVersionUse = { id: 'use', workspaceId: 'workspace', evidence: { id: 'evidence', revision: 0, hash: '0000000000000000' },
  at: '2026-10-28T20:00:00Z', personId: 'approver', productionId: 'production', stage: 'approved', article, blockId: 'b1', from: 0, to: 42 };
const version = { id: 'v1', productionId: 'production', pieceId: 'piece', number: 1, hash, body };
test('historical use opens the exact frozen body and its actual range', () => {
  assert.equal(memoryUsedArticle(use, version), body);
  assert.equal(memoryUsedArticle({ ...use, stage: 'published', publicationReceipt: 'actual-publication' }, version), body);
  assert.equal(memoryUsedArticle(use, { ...version, id: 'v2', number: 2 }), null);
});
test('foreign scope, forged version numbers, changed bodies and invalid ranges never show a replacement article', () => {
  for (const changed of [{ ...version, productionId: 'foreign' }, { ...version, pieceId: 'foreign' }, { ...version, number: 2 },
    { ...version, hash: 'ffffffffffffffff' }, { ...version, body: { ...body, title: 'Changed after approval' } }]) assert.equal(memoryUsedArticle(use, changed), null);
  for (const range of [{ blockId: 'missing' }, { from: -1 }, { from: 0.5 }, { to: 0 }, { to: 999 }]) assert.equal(memoryUsedArticle({ ...use, ...range }, version), null);
});
