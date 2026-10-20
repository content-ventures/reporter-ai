import assert from 'node:assert/strict';
import { test } from 'node:test';
import { garbledSegment, repairedText, repairWindow, type TimedWord } from './reporter.ts';

// What Whisper returned for 88–105 s of a real stand interview: every word cut at its first accent.
const GARBLED = 'Ent eu trouxe alguns panoramas como por exemplo compara com outras esp su aves e tamb salmonicultura de quanto n estamos em distribui de custos ou seja quanto ra quanto sanidade quanto gen e pra mostrar que sim n estamos no caminho certo existe uma evolu';
// The same stretch transcribed again on its own, 84–109 s: the margin brings words of both neighbours.
const WINDOW = 'a parte de sanidade e como isso pode ser modificado a longo prazo. Então eu trouxe alguns panoramas, como por exemplo, comparação com outras espécies, suínos, aves e também salmonicultura, de quanto nós estamos em distribuição de custos, ou seja, quanto é ração, quanto é sanidade, quanto é genética, e para mostrar que sim, nós estamos no caminho certo, existe uma evolução para acontecer, mas já evoluímos muito de 10 anos para cá.';
const REPAIRED = 'Então eu trouxe alguns panoramas, como por exemplo, comparação com outras espécies, suínos, aves e também salmonicultura, de quanto nós estamos em distribuição de custos, ou seja, quanto é ração, quanto é sanidade, quanto é genética, e para mostrar que sim, nós estamos no caminho certo, existe uma evolução';
const words = (text: string): TimedWord[] => text.split(' ').map((word, at) => ({ word, start_ms: at * 300, end_ms: at * 300 + 250 }));
const segment = { start_ms: 88_160, end_ms: 105_629, text: GARBLED };

test('a long Portuguese segment with no accented letter is garbled; normal speech is not', () => {
  assert.equal(garbledSegment(segment, 'pt-BR'), true);
  assert.equal(garbledSegment({ ...segment, text: 'A gente tem o município que mais produz tilápias no Brasil, que está aqui em Minas Gerais.' }, 'pt-BR'), false);
  assert.equal(garbledSegment({ ...segment, text: 'muito de 10 anos pra cá' }, 'pt-BR'), false, 'short segments are left alone');
  assert.equal(garbledSegment(segment, 'en'), false, 'only Portuguese has the accent signal');
});

test('the window adds a margin inside the recording', () => {
  assert.deepEqual(repairWindow(segment, 196.6), { start: 85.16, duration: 105.629 + 3 - 85.16 });
  assert.deepEqual(repairWindow({ start_ms: 1000, end_ms: 4000, text: '' }, 5), { start: 0, duration: 5 });
});

test('the repair is the span of the new words that, cut at their accents, aligns with the garbled ones', () => {
  // Real data: the margin words of both neighbours fall outside; "pra"/"para" is within the tolerance.
  assert.equal(repairedText(GARBLED, words(WINDOW)), REPAIRED);
});

test('a repair that does not explain the garbled words never replaces them', () => {
  const window = words(WINDOW);
  // Whisper stopped early: the tail of the speech would be lost.
  assert.equal(repairedText(GARBLED, window.slice(0, 40)), undefined);
  // A different stretch, or a translation of an English quote, does not align.
  assert.equal(repairedText('the main goal of the project is to deliver value for our customers in Brazil',
    words('o principal objetivo do projeto é entregar valor para os nossos clientes no Brasil')), undefined);
  // Correct speech that simply has no accent stays as it was.
  const plain = 'o pessoal que trabalha com peixe aqui no estado de Minas Gerais tem muito orgulho disso';
  assert.equal(repairedText(plain, words(`${plain} É`)), undefined);
});

test('the edges come from the garbled words, not from timestamps: no word lost or doubled', () => {
  // "n estamos" is "Não estamos" cut at its accent: the "Não" of the window is kept, the negation intact.
  assert.equal(repairedText('n estamos no caminho certo e a sanidade tem um custo alto para o produtor hoje',
    words('prazo. Não estamos no caminho certo e a sanidade tem um custo alto para o produtor hoje. Então')),
  'Não estamos no caminho certo e a sanidade tem um custo alto para o produtor hoje.');
  // The next segment's first word, inside the margin, is not appended.
  assert.equal(repairedText(GARBLED, words(`${WINDOW} Certo, agora`)), REPAIRED);
});

test('an extra word of the second decoding next to an edge never takes the place of the edge word', () => {
  const garbledEnd = 'e o produtor que trabalha com til aqui no estado de Minas sabe que n';
  assert.equal(repairedText(garbledEnd, words('prazo. E o produtor que trabalha com tilápia aqui no estado de Minas sabe que isso não. Certo')),
    'E o produtor que trabalha com tilápia aqui no estado de Minas sabe que isso não.');
  assert.equal(repairedText('a gente evoluiu muito no pa de 10 anos c', words('a gente evoluiu muito no país de 10 anos pra cá. Certo')),
    'a gente evoluiu muito no país de 10 anos pra cá.');
  assert.equal(repairedText('n acho que o pessoal que trabalha com til aqui no estado tem orgulho',
    words('prazo. Não eu acho que o pessoal que trabalha com tilápia aqui no estado tem orgulho. E')),
  'Não eu acho que o pessoal que trabalha com tilápia aqui no estado tem orgulho.');
  assert.equal(repairedText(GARBLED, words(`a longo prazo. ${REPAIRED.replace('Então eu', 'Então tipo eu')} para acontecer`)), REPAIRED.replace('Então eu', 'Então tipo eu'));
});
