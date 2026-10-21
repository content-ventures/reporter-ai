import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ungroundedTerms } from './grounding.ts';
import type { SourceRef } from './refs.ts';
import { sourceAttributionGroundingText } from './source-attribution-grounding.ts';
import { writingResearchEvidence } from './writing-research-evidence.ts';

function fixture(url = 'https://www.instagram.com/reel/example', title = 'Documento sobre o produto', publishedOn: string | null = '2022-11-22') {
  const excerpt = 'O produto foi descrito como inativado.';
  const evidence = writingResearchEvidence([{ id: 'web-test', kind: 'external', provider: 'tavily', query: 'produto', url,
    title, site: new URL(url).hostname, excerpt, publishedOn, retrievedAt: '2026-10-21T12:00:00Z' }],
  { runId: 'run-test', workspaceId: 'workspace-test', actorId: 'editor-test' });
  const refs = [...evidence.references.values()];
  const missing = (text: string, references: readonly SourceRef[] = refs) =>
    ungroundedTerms(sourceAttributionGroundingText(text, evidence.sources, references), excerpt);
  return { ...evidence, refs, missing };
}

test('a cited website identifies its publication without becoming a factual corpus', () => {
  const { missing } = fixture();
  const text = 'Em publicação no Instagram, o produto foi descrito como inativado.';
  assert.deepEqual(ungroundedTerms(text, 'O produto foi descrito como inativado.'), ['Instagram']);
  assert.deepEqual(missing(text), []);
  assert.deepEqual(missing('Em publicação no Instagram, o produto eliminou BacteriumX em 99% dos casos.'), ['99', 'BacteriumX']);
  assert.deepEqual(missing('Em publicação no Instagram, o produto foi descrito como inativado. A rede Instagram confirmou a eficácia.'), ['Instagram']);
  assert.deepEqual(missing('Segundo o Instagram, o produto foi descrito como inativado.'), ['Instagram'], 'hosting does not establish the speaker');
  assert.deepEqual(missing('A publicação pelo Instagram descreve o produto como inativado.'), ['Instagram']);
  assert.deepEqual(missing('Uma publicação do Instagram descreve o produto como inativado.'), ['Instagram']);
  assert.deepEqual(missing('O produto foi fabricado pelo site Instagram.'), ['Instagram']);
  assert.deepEqual(missing('O portal Instagram desenvolveu a vacina.'), ['Instagram']);
  assert.deepEqual(missing('Em publicação no Instagram, a pesquisadora Marina Souza informou o resultado.'), ['Marina', 'Souza']);
});

test('metadata support requires an authorized, retained excerpt reference with matching URL and version', () => {
  const { missing, refs, sources } = fixture();
  const text = 'Em publicação no Instagram, o produto foi descrito como inativado.';
  assert.deepEqual(missing(text, []), ['Instagram']);
  assert.deepEqual(missing(text, [{ ...refs[0], sourceId: 'other' }]), ['Instagram']);
  assert.deepEqual(missing(text, [{ ...refs[0], sourceVersion: 99 }]), ['Instagram']);
  const locator = refs[0].locator;
  assert.equal(locator.type, 'url');
  if (locator.type !== 'url') return;
  assert.deepEqual(missing(text, [{ ...refs[0], locator: { ...locator, url: 'https://example.org' } }]), ['Instagram']);
  assert.deepEqual(missing(text, [{ ...refs[0], locator: { ...locator, excerpt: 'An invented excerpt.' } }]), ['Instagram']);
  sources[0].rights.authorized = false;
  assert.deepEqual(missing(text), ['Instagram']);
});

test('host identity does not come from a path, lookalike host or subdomain fragment', () => {
  for (const url of ['https://example.org/instagram', 'https://instagram.example.org/reel/example', 'https://instagram.com.evil.test/reel/example']) {
    assert.deepEqual(fixture(url).missing('Em publicação no Instagram, o produto foi descrito como inativado.'), ['Instagram']);
  }
  assert.deepEqual(fixture('https://www.woah.org/report.pdf').missing('Em relatório no site da WOAH, o produto foi descrito como inativado.'), []);
});

test('publication dates are scoped to source identification, never launch dates or quantities', () => {
  const { missing } = fixture('https://sucessonocampo.com.br/artigo');
  assert.deepEqual(missing('Em 2022, o site Sucesso no Campo descreveu o produto como inativado.'), []);
  assert.deepEqual(missing('Em 2022, o site Sucesso no Campo o descreveu como inativado.'), []);
  assert.deepEqual(missing('Em 2022, o site Sucesso no Campo contratou pessoas.'), ['2022', 'Sucesso', 'Campo']);
  assert.deepEqual(missing('Em 2022, o site Sucesso no Campo foi fechado.'), ['2022', 'Sucesso', 'Campo']);
  assert.deepEqual(missing('No site Sucesso no Campo, o produto foi lançado em 2022.'), ['2022']);
  assert.deepEqual(missing('Em 2022, o site Sucesso no Campo descreveu o produto. A empresa vendeu 2022 doses.'), ['2022']);
  assert.deepEqual(missing('Em 2026, o site Sucesso no Campo descreveu o produto.'), ['2026'], 'retrieval dates never date a publication');
  assert.deepEqual(missing('Na publicação de 2022 no Sucesso no Campo, o produto foi descrito como inativado.'), []);
  assert.deepEqual(missing('No site Sucesso no Campo publicado em 22/11/2022, o produto foi descrito como inativado.'), []);
  assert.deepEqual(missing('No site Sucesso no Campo publicado em 23/11/2022, o produto foi descrito como inativado.'), ['23', '11', '2022']);
  assert.deepEqual(fixture('https://sucessonocampo.com.br/2022/artigo', undefined, null)
    .missing('Em 2022, o site Sucesso no Campo descreveu o produto.'), ['2022'], 'a URL year is not a publication date');
});

test('only an explicitly named complete title may use title metadata', () => {
  const { missing } = fixture('https://example.org/article', 'Relatório de Marina sobre BacteriumX em 2022');
  assert.deepEqual(missing('No documento intitulado Relatório de Marina sobre BacteriumX em 2022, o produto foi descrito como inativado.'), []);
  assert.deepEqual(missing('No documento intitulado Relatório de Marina sobre BacteriumX em 2022, foram vendidas 2022 doses.'), ['2022']);
  assert.deepEqual(missing('A pesquisadora Marina comprovou a eficácia contra BacteriumX em 2022.'), ['2022', 'Marina', 'BacteriumX']);
  assert.deepEqual(missing('No documento intitulado Relatório de Marina, o produto foi descrito como inativado.'), ['Relatório', 'Marina']);
});
