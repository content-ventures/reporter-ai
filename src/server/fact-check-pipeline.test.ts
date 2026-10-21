import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AUTO_FACT_CHECKS, autoFactCheckIds, runFactCheck, EXTRACTION_INSTRUCTION } from './fact-check-pipeline.ts';
import type { Generate, Search } from './fact-check-pipeline.ts';
import type { FactSource } from '../domain/fact-check.ts';

const subject = { id: 'c1', text: 'Fala literal de teste com dados.', speaker: 'Ana Costa', recordedOn: '2026-10-12' };
const found = (site: string): FactSource => ({ url: `https://${site}/x`, title: `Título ${site}`, site, excerpt: `Trecho de ${site}.` });
const now = () => '2026-10-20T12:00:00.000Z';

function providers(extraction: unknown, judgement: unknown, results: Record<string, FactSource[]>) {
  const searches: string[] = [], calls: unknown[] = [];
  const generate: Generate = async (instruction, input) => {
    calls.push(input);
    return { value: instruction === EXTRACTION_INSTRUCTION ? extraction : judgement, model: instruction === EXTRACTION_INSTRUCTION ? 'extractor' : 'judge' };
  };
  const search: Search = async query => { searches.push(query); return results[query] ?? []; };
  return { generate, search, searches, calls };
}

test('claims are typed, searched once each and judged only with returned sources', async () => {
  const deps = providers({ claims: [
    { text: 'O Brasil importa salmão do Chile.', kind: 'fact', query: 'origem do salmão importado pelo Brasil' },
    { text: 'O Brasil é o maior exportador de camarão.', kind: 'fact', query: 'maiores exportadores de camarão ranking' },
    { text: 'O setor está subestimado.', kind: 'opinion', query: 'ignorada' },
  ], strength: 4, strengthReason: 'Dado concreto.' }, { verdicts: [
    { claim: 1, verdict: 'validated', evidence: [1], reason: 'O Valor diz que 99,6% vêm do Chile.' },
    { claim: 2, verdict: 'disputed', evidence: [1], reason: 'Cita um trecho de outra afirmação.' },
  ] }, { 'origem do salmão importado pelo Brasil': [found('valor.globo.com')], 'maiores exportadores de camarão ranking': [found('seafoodbrasil.com.br')] });
  const check = await runFactCheck(subject, { ...deps, now }, AbortSignal.timeout(1000));
  assert.deepEqual(deps.searches, ['origem do salmão importado pelo Brasil', 'maiores exportadores de camarão ranking'], 'neutral queries, opinions never searched');
  assert.equal(check.claims[0].verdict, 'validated');
  assert.equal(check.claims[0].sources[0].site, 'valor.globo.com');
  assert.equal(check.claims[1].verdict, 'not_validated', 'a source returned for another claim is not evidence');
  assert.deepEqual(check.claims[1].sources, []);
  assert.equal(check.claims[2].verdict, undefined);
  assert.equal(check.model, 'judge');
  assert.deepEqual(check.strength, { score: 4, reason: 'Dado concreto.' });
  assert.equal(check.checkedAt, now());
});

test('beyond three checkable claims nothing is searched, and opinions alone skip the search', async () => {
  const many = providers({ claims: [1, 2, 3, 4].map(n => ({ text: `Fato número ${n}.`, kind: 'fact', query: `busca ${n}` })), strength: 2, strengthReason: '' },
    { verdicts: [] }, {});
  const check = await runFactCheck(subject, { ...many, now }, AbortSignal.timeout(1000));
  assert.equal(many.searches.length, 3);
  assert.match(check.claims[3].reason ?? '', /limite/);
  assert.match(check.claims[0].reason ?? '', /não encontrou fontes/);
  assert.equal(many.calls.length, 1, 'no evidence at all: the judge is not called');
  const opinions = providers({ claims: [{ text: 'Vai ser um ótimo ano.', kind: 'forecast', query: '' }], strength: 1, strengthReason: 'Genérica.' }, null, {});
  const only = await runFactCheck(subject, { ...opinions, now }, AbortSignal.timeout(1000));
  assert.equal(opinions.searches.length, 0);
  assert.equal(only.model, 'extractor');
});

test('an output outside the contract is refused, never stored', async () => {
  const broken = providers({ claims: [] }, null, {});
  await assert.rejects(runFactCheck(subject, { ...broken, now }, AbortSignal.timeout(1000)), { message: 'FACT_CHECK_INVALID' });
});

test('a generated text queues only the citations it quotes, up to the automatic limit', () => {
  const quoted = Array.from({ length: AUTO_FACT_CHECKS + 1 }, (_, index) => ({ id: `q${index}`, origin: 'article' as const, authorConfirmed: true, personId: 'ana' }));
  const suggestion = { id: 's1', origin: 'outline' as const, authorConfirmed: false, personId: 'ana' };
  assert.deepEqual(autoFactCheckIds([suggestion, ...quoted.slice(0, 2)]), ['q0', 'q1']);
  assert.deepEqual(autoFactCheckIds([suggestion]), []);
  assert.equal(autoFactCheckIds([...quoted, suggestion]).length, AUTO_FACT_CHECKS);
  // Once a person confirms its author, an outline passage is a citation like any other.
  assert.deepEqual(autoFactCheckIds([{ ...suggestion, authorConfirmed: true }]), ['s1']);
  // A quote without the person who said it is not a citation yet: never checked.
  assert.deepEqual(autoFactCheckIds([{ id: 'n1', origin: 'article', authorConfirmed: false }]), []);
});
