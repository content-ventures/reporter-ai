import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FactCheck, FactClaim } from './fact-check.ts';
import { veracityCheck } from './veracity-check.ts';

const range = (blockId: string) => ({ blockId, from: 0, to: 10 });
const check = (claims: FactClaim[]): FactCheck => ({ id: 'x', checkedAt: '2026-10-20T12:00:00Z', model: 'test', claims, strength: { score: 3, reason: '' }, overrides: [], history: [] });
const source = { url: 'https://a.exemplo/x', title: 'A', site: 'a.exemplo', excerpt: 'Trecho.' };

test('a disputed quotation warns and points at it; checks never block', () => {
  const result = veracityCheck(
    [{ range: range('p1'), text: 'O Brasil é o maior exportador de camarão' }, { range: range('p2'), text: 'o setor vai crescer muito neste ano' }],
    [{ text: 'o Brasil é o maior exportador de camarão.', factCheck: check([{ text: 'Maior exportador', kind: 'fact', verdict: 'disputed', sources: [source] }]) },
      { text: 'O setor vai crescer muito neste ano', factCheck: check([{ text: 'Vai crescer', kind: 'forecast', sources: [] }]) }],
  )!;
  assert.equal(result.status, 'warn');
  assert.equal(result.blocking, false);
  assert.equal(result.detail, '1 fala contestada');
  assert.deepEqual(result.targets, [range('p1')]);
  assert.deepEqual(result.progress, { current: 1, total: 2 });
});

test('a quotation no source validated also warns; pending, settled and absent checks', () => {
  const quotes = [{ range: range('p1'), text: 'a tilápia responde por mais de 60% da piscicultura' }];
  assert.equal(veracityCheck(quotes, [{ text: 'A tilápia responde por mais de 60% da piscicultura.' }])?.status, 'info');
  const unvalidated = veracityCheck(quotes, [{ text: 'A tilápia responde por mais de 60% da piscicultura.', factCheck: check([{ text: 'Tilápia 60%', kind: 'fact', verdict: 'not_validated', sources: [] }]) }])!;
  assert.deepEqual([unvalidated.status, unvalidated.detail, unvalidated.targets], ['warn', '1 fala não validada', [range('p1')]]);
  const done = veracityCheck(quotes, [{ text: 'A tilápia responde por mais de 60% da piscicultura.', factCheck: check([{ text: 'Tilápia 60%', kind: 'fact', verdict: 'validated', sources: [source] }]) }])!;
  assert.deepEqual([done.status, done.detail], ['pass', '1 de 1 afirmação validada']);
  assert.equal(veracityCheck(quotes, []), undefined, 'no checked citation: no row');
});
