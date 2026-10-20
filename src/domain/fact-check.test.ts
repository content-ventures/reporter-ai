import assert from 'node:assert/strict';
import { test } from 'node:test';
import { citationScore, citationVerdict, claimTally, DISPUTED_CEILING, primarySource, recheck, settleClaim, siteOf, tallyLabel } from './fact-check.ts';
import type { FactCheck, FactClaim, FactSource } from './fact-check.ts';

const source = (url: string): FactSource => ({ url, title: 'Título da busca', site: siteOf(url), excerpt: 'Trecho devolvido pela busca.' });
const ibge = source('https://www.ibge.gov.br/pesca'), embrapa = source('https://www.embrapa.br/tilapia');
const claim = (kind: FactClaim['kind'], verdict?: FactClaim['verdict'], sources: FactSource[] = []): FactClaim =>
  ({ text: `Afirmação ${kind} ${verdict ?? ''}`, kind, ...(verdict ? { verdict } : {}), sources });
const check = (claims: FactClaim[], strength = 3): FactCheck =>
  ({ id: 'c1', checkedAt: '2026-10-20T12:00:00Z', model: 'test', claims, strength: { score: strength, reason: '' }, overrides: [], history: [] });
const score = (value: FactCheck | undefined, extra: Partial<Parameters<typeof citationScore>[0]> = {}) =>
  citationScore({ check: value, authorConfirmed: true, sourceNamed: true, dated: true, linked: true, uses: 5, ...extra });

test('a verdict keeps only sources the search returned, and needs one', () => {
  const invented = settleClaim({ ...claim('fact', 'validated'), sources: [source('https://inventado.exemplo/x')] }, [ibge]);
  assert.equal(invented.verdict, 'not_validated');
  assert.deepEqual(invented.sources, []);
  assert.match(invented.reason ?? '', /Nenhuma fonte/);
  const real = settleClaim({ ...claim('fact', 'validated'), sources: [{ ...ibge, title: 'Título do modelo' }, ibge] }, [ibge]);
  assert.equal(real.verdict, 'validated');
  assert.deepEqual(real.sources, [ibge], 'the search result wins over what the model wrote, once per URL');
  assert.equal(settleClaim({ ...claim('declared', 'disputed'), sources: [embrapa] }, [embrapa]).verdict, 'disputed');
  assert.deepEqual(settleClaim({ ...claim('fact', 'not_validated'), sources: [ibge] }, [ibge]).sources, [], 'not validated shows no source');
  const opinion = settleClaim({ ...claim('opinion', 'validated'), sources: [ibge], query: 'x' }, [ibge]);
  assert.equal(opinion.verdict, undefined);
  assert.deepEqual(opinion.sources, []);
});

test('the quote seal is the worst checkable verdict; an editor decision wins', () => {
  assert.equal(citationVerdict(undefined), 'pending');
  assert.equal(citationVerdict(check([claim('opinion'), claim('forecast')])), 'not_checkable');
  assert.equal(citationVerdict(check([claim('fact', 'validated', [ibge]), claim('opinion')])), 'validated');
  assert.equal(citationVerdict(check([claim('fact', 'validated', [ibge]), claim('declared', 'not_validated')])), 'not_validated');
  const disputed = check([claim('fact', 'disputed', [ibge]), claim('fact', 'not_validated')]);
  assert.equal(citationVerdict(disputed), 'disputed');
  const decided = { ...disputed, overrides: [{ claim: 0, verdict: 'validated' as const, reason: 'Dado da fonte oficial de 2026.', personId: 'ana', at: '2026-10-20T13:00:00Z' }] };
  assert.equal(citationVerdict(decided), 'not_validated');
  assert.deepEqual(claimTally(decided), { kinds: { fact: 2, declared: 0, opinion: 0, forecast: 0 }, checkable: 2, validated: 1 });
});

test('the score explains its parts, caps a disputed quote and never penalises an opinion', () => {
  assert.equal(score(undefined), undefined, 'no score before the check');
  const opinion = score(check([claim('opinion')], 5))!;
  assert.deepEqual(opinion, { total: 100, veracity: 40, strength: 20, attribution: 20, usage: 20, capped: false });
  const unknown = score(check([claim('fact', 'not_validated')], 1), { uses: 0, linked: false, authorConfirmed: false })!;
  assert.deepEqual(unknown, { total: 27, veracity: 20, strength: 0, attribution: 7, usage: 0, capped: false });
  const popular = score(check([claim('fact', 'disputed', [ibge]), claim('fact', 'validated', [embrapa])], 5), { uses: 12 })!;
  assert.equal(popular.total, DISPUTED_CEILING);
  assert.equal(popular.capped, true);
  assert.equal(popular.usage, 20, 'uses saturate');
});

test('labels, primary source and a recheck that keeps editor decisions', () => {
  const value = check([claim('fact', 'not_validated'), claim('fact', 'validated', [embrapa]), claim('opinion')]);
  assert.equal(tallyLabel(claimTally(value)), '2 fatos · 1 opinião');
  assert.equal(primarySource(value)?.site, 'embrapa.br');
  const decided = { ...value, overrides: [{ claim: 0, verdict: 'validated' as const, reason: 'Confirmado por telefone.', personId: 'ana', at: '2026-10-20T13:00:00Z' }] };
  const next = recheck(decided, { id: 'c1', checkedAt: '2026-10-21T12:00:00Z', model: 'test', strength: { score: 3, reason: '' },
    claims: [claim('opinion'), { ...value.claims[0], verdict: 'not_validated' }] });
  assert.deepEqual(next.overrides.map(entry => entry.claim), [1], 'the decision follows its claim text');
  assert.deepEqual(next.history, [{ checkedAt: '2026-10-20T12:00:00Z', verdict: 'validated' }], 'the seal the editor saw');
  assert.equal(citationVerdict(next), 'validated');
});
