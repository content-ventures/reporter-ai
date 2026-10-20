import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropUngroundedSentences, numberWords, ungroundedTerms } from './grounding.ts';

const material = [
  'Sérgio Sousa: Nós trouxemos o bacalhau com sal rosa para a feira.',
  'Sérgio Sousa: O produto, no último ano, teve uma subida cerca de trinta por cento.',
  'Sérgio Sousa: Já estamos aqui há 23 anos e vendemos 1.200 toneladas.',
  'Sérgio Sousa, diretor, BomPORTO',
  'Seafood Show Latin America 2026', 'De 20 a 22 de outubro de 2026', 'Distrito Anhembi',
].join('\n');

test('numbers said in words count: a transcript may say "trinta" for 30', () => {
  assert.equal(numberWords(30), 'trinta');
  assert.equal(numberWords(2026), 'dois mil e vinte e seis');
  assert.equal(numberWords(1200), 'mil e duzentos');
  assert.equal(numberWords(17), 'dezessete');
  assert.deepEqual(ungroundedTerms('O preço subiu 30% no último ano.', material), []);
});

test('numbers and names from the material, speakers and event are grounded', () => {
  const text = 'O diretor da BomPORTO, Sérgio Sousa, contou que a empresa está há 23 anos no mercado e vendeu 1.200 toneladas na Seafood Show Latin America 2026, no Distrito Anhembi.';
  assert.deepEqual(ungroundedTerms(text, material), []);
});

test('an invented number or name is reported, once, in order', () => {
  const text = 'A BomPORTO cresceu 45% e projeta R$ 17,8 bilhões com a Frescatto. A Frescatto também cresceu.';
  assert.deepEqual(ungroundedTerms(text, material), ['45', '17,8', 'Frescatto']);
});

test('a style reference leaking into the text is caught', () => {
  assert.deepEqual(ungroundedTerms('A empresa celebrou a Quaresma de 2026 na APAS Show.', material), ['Quaresma', 'APAS']);
});

test('sentence-initial words and words inside quotes are not taken as invented names', () => {
  const text = 'Segundo o diretor, a feira foi boa. “Nós trouxemos o bacalhau com sal rosa para a feira”, explicou Sousa.';
  assert.deepEqual(ungroundedTerms(text, material), []);
});

test('the last resort drops only the sentences with invented terms', () => {
  const paragraphs = [
    { text: 'A BomPORTO levou o bacalhau com sal rosa. A empresa cresceu 45% em 2025.', evidenceIds: ['1'] },
    { text: 'Faturou R$ 3 milhões.', evidenceIds: ['2'] },
  ];
  assert.deepEqual(dropUngroundedSentences(paragraphs, material), [{ text: 'A BomPORTO levou o bacalhau com sal rosa.', evidenceIds: ['1'] }]);
});
