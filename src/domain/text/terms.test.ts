import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replaceTerm, termOccurrences } from './terms.ts';

const SRT = `1
00:00:00,000 --> 00:00:09,000
Bom, André, falando sobre o objetivo da MSD de ter vindo para a Q Show.

2
00:00:12,000 --> 00:00:21,000
A Q  Show está no nosso calendário, todas as edições da q show, desde Santa Fá do Sul.`;

test('a misheard name is replaced as whole words in any case, and the timestamps stay intact', () => {
  assert.equal(termOccurrences(SRT, 'Q Show'), 3);
  const fixed = replaceTerm(SRT, 'q show', 'Aquishow');
  assert.equal(fixed.count, 3);
  assert.match(fixed.text, /para a Aquishow\./u);
  assert.match(fixed.text, /edições da Aquishow,/u);
  assert.match(fixed.text, /^00:00:12,000 --> 00:00:21,000$/mu);
  assert.equal(replaceTerm(fixed.text, 'Santa Fá do Sul', 'Santa Fé do Sul').count, 1);
});

test('only whole words change, never a part of another word, a cue number or a timestamp', () => {
  assert.equal(termOccurrences('O agente reconhece a gente.', 'gente'), 1);
  assert.equal(replaceTerm(SRT, '00', 'zero').count, 0, 'timestamps and cue numbers are not speech');
  assert.equal(replaceTerm(SRT, '1', 'um').text, SRT);
  assert.equal(replaceTerm('A ISKNV e a SKNV.', 'SKNV', 'ISKNV').text, 'A ISKNV e a ISKNV.');
});

test('an empty term or replacement changes nothing; special characters are literal', () => {
  assert.equal(replaceTerm(SRT, '  ', 'x').count, 0);
  assert.equal(replaceTerm(SRT, 'Q Show', '  ').count, 0);
  assert.equal(replaceTerm('Preço de R$ 10 (fixo).', '(fixo)', '(variável)').text, 'Preço de R$ 10 (variável).');
  assert.equal(replaceTerm('A vacina Iridover chegou.', 'Iridover', 'Aquavac IridoV $1').text, 'A vacina Aquavac IridoV $1 chegou.');
});
