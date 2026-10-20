import assert from 'node:assert/strict';
import { test } from 'node:test';
import { garbledSegment, repairedText, repairWindow, type TimedWord } from './reporter.ts';

// What Whisper returned for 88–105 s of a real stand interview: every word cut at its first accent.
const GARBLED = 'Ent eu trouxe alguns panoramas como por exemplo compara com outras esp su aves e tamb salmonicultura de quanto n estamos em distribui de custos ou seja quanto ra quanto sanidade quanto gen e pra mostrar que sim n estamos no caminho certo existe uma evolu';
// The same stretch transcribed again on its own (84–109 s): the margin brings words of both neighbours.
const BEFORE = 'a parte de sanidade e como isso pode ser modificado a longo prazo.';
const INSIDE = 'Então eu trouxe alguns panoramas, como por exemplo, comparação com outras espécies, suínos, aves e também salmonicultura, de quanto nós estamos em distribuição de custos, ou seja, quanto é ração, quanto é sanidade, quanto é genética, e para mostrar que sim, nós estamos no caminho certo, existe uma evolução';
const AFTER = 'para acontecer, mas já evoluímos muito de 10 anos para cá.';
// Every token of the first transcription stays as it wrote it ("pra", no commas); only the cut words are
// completed, with letters only, and the "é" it dropped whole is restored between two confirmed words.
const REPAIRED = 'Então eu trouxe alguns panoramas como por exemplo comparação com outras espécies suínos aves e também salmonicultura de quanto nós estamos em distribuição de custos ou seja quanto é ração quanto é sanidade quanto é genética e pra mostrar que sim nós estamos no caminho certo existe uma evolução';

/** Words placed one after another from `startMs`, 300 ms apart (the window starts at 0 s). */
const timed = (text: string, startMs: number): TimedWord[] =>
  text.split(' ').filter(Boolean).map((word, at) => ({ word, start_ms: startMs + at * 300, end_ms: startMs + at * 300 + 250 }));
/** A segment between the margins: words before it end before `start`, words after it start after `end`. */
function window(before: string, inside: string, after: string) {
  const head = timed(before, 0), start = head.length * 300 + 100;
  const body = timed(inside, start), end = start + body.length * 300;
  return { words: [...head, ...body, ...timed(after, end + 100)], start, end };
}
const repair = (garbled: string, before: string, inside: string, after = '') => {
  const { words, start, end } = window(before, inside, after);
  return repairedText({ start_ms: start, end_ms: end, text: garbled }, words, 0);
};

test('a long Portuguese segment with no accented letter is garbled; normal speech is not', () => {
  const segment = { start_ms: 88_160, end_ms: 105_629, text: GARBLED };
  assert.equal(garbledSegment(segment, 'pt-BR'), true);
  assert.equal(garbledSegment({ ...segment, text: 'A gente tem o município que mais produz tilápias no Brasil, que está aqui em Minas Gerais.' }, 'pt-BR'), false);
  assert.equal(garbledSegment({ ...segment, text: 'muito de 10 anos pra cá' }, 'pt-BR'), false, 'short segments are left alone');
  assert.equal(garbledSegment(segment, 'en'), false, 'only Portuguese has the accent signal');
  assert.deepEqual(repairWindow(segment, 196.6), { start: 85.16, duration: 105.629 + 3 - 85.16 });
  assert.deepEqual(repairWindow({ start_ms: 1000, end_ms: 4000, text: '' }, 5), { start: 0, duration: 5 });
});

test('the cut words are completed from the new words spoken inside the segment; every other word stays', () => {
  assert.equal(repair(GARBLED, BEFORE, INSIDE, AFTER), REPAIRED);
});

test('a new transcription of another stretch, a translation or a shorter text changes nothing', () => {
  assert.equal(repair(GARBLED, BEFORE, INSIDE.split(' ').slice(0, 25).join(' ')), undefined, 'too little of the segment confirmed');
  assert.equal(repair('the main goal of the project is to deliver value for our customers in Brazil', '',
    'o principal objetivo do projeto é entregar valor para os nossos clientes no Brasil'), undefined);
  // Correct speech that simply has no accent stays as it was, even with a neighbour's "É" around it.
  const plain = 'o pessoal que trabalha com peixe aqui no estado de Minas Gerais tem muito orgulho disso';
  assert.equal(repair(plain, 'prazo.', `${plain} É`), undefined);
});

test("a neighbour's word never stands in for this segment's word, and nothing is lost at an edge", () => {
  const ending = 'e o produtor que trabalha com til aqui no estado de Minas sabe que n';
  // The new transcription missed the "não": the neighbour's "Nós" is outside the segment, the "n" stays.
  assert.equal(repair(ending, '', 'e o produtor que trabalha com tilápia aqui no estado de Minas sabe que', 'Nós vamos crescer'),
    'e o produtor que trabalha com tilápia aqui no estado de Minas sabe que n');
  assert.equal(repair(ending, '', 'e o produtor que trabalha com tilápia aqui no estado de Minas sabe que isso não.', 'Certo'),
    'e o produtor que trabalha com tilápia aqui no estado de Minas sabe que não', 'an extra word is not added');
  const opening = 'n acho que o pessoal que trabalha com til aqui no estado tem orgulho';
  assert.equal(repair(opening, 'a longo prazo, né?', 'Acho que o pessoal que trabalha com tilápia aqui no estado tem orgulho.'),
    'n acho que o pessoal que trabalha com tilápia aqui no estado tem orgulho', 'the "né" before the segment is not this "n"');
  assert.equal(repair(opening, 'prazo.', 'Não acho que o pessoal que trabalha com tilápia aqui no estado tem orgulho.'),
    'não acho que o pessoal que trabalha com tilápia aqui no estado tem orgulho', 'the first pass wrote it lowercase');
  // Both "não" stay; the filler of the second transcription is not added.
  assert.equal(repair('Ent a gente fez um teste com o pessoal e voc sabe que n n', 'Olha',
    'Então a gente fez um teste com o pessoal e você sabe que não cara não.', 'Certo'),
  'Então a gente fez um teste com o pessoal e você sabe que não não');
  assert.equal(repair(GARBLED, BEFORE, INSIDE.replace('Então eu', 'Então tipo eu'), AFTER), REPAIRED);
});

test('accent words go only between confirmed words with nothing between them; first-pass tokens keep their form', () => {
  // "ele" was misheard the second time: the "é" is not moved ahead of it, and nothing is doubled.
  assert.equal(repair('Ent ele muito bom no que faz e todo mundo sabe disso aqui na empresa', '',
    'Então eli é muito bom no que faz e todo mundo sabe disso aqui na empresa'),
  'Então ele muito bom no que faz e todo mundo sabe disso aqui na empresa');
  assert.equal(repair('Ent isso e muito importante para a gente porque a gente trabalha com isso', '',
    'Então isso é muito importante para a gente porque a gente trabalha com isso'),
  'Então isso e muito importante para a gente porque a gente trabalha com isso');
  // A question stays a question, a name keeps its capital, symbols stay.
  assert.equal(repair('Voc vai votar no Lula? Eu n sei ainda se vou votar nele ou no outro candidato', '',
    'Você vai votar no lula. Eu não sei ainda se vou votar nele ou no outro candidato'),
  'Você vai votar no Lula? Eu não sei ainda se vou votar nele ou no outro candidato');
  assert.equal(repair('A Johnson & Johnson cresceu 10 % no ano passado segundo o relat da empresa hoje', '',
    'A Johnson Johnson cresceu 10 no ano passado segundo o relatório da empresa hoje'),
  'A Johnson & Johnson cresceu 10 % no ano passado segundo o relatório da empresa hoje');
});

test('a cut word keeps its own punctuation after the completion, and an ambiguous pairing completes nothing', () => {
  assert.equal(repair('Ent, a gente foi pra casa e depois a gente voltou pro trabalho cedo', '',
    'Então, a gente foi pra casa e depois a gente voltou pro trabalho cedo'),
  'Então, a gente foi pra casa e depois a gente voltou pro trabalho cedo');
  // "na na": the new "nação" could be either one, so both stay; the clear "manh" is completed.
  assert.equal(repair('ele falou na na hoje e a gente voltou pro trabalho cedo de manh', '',
    'ele falou nação hoje e a gente voltou pro trabalho cedo de manhã'),
  'ele falou na na hoje e a gente voltou pro trabalho cedo de manhã');
});

test('a pairing is used only when every best alignment makes it, from either side', () => {
  const base = 'eu acho que essa gente sabe disso muito bem ';
  // The negation stays: "n" could be "né" or "não" just as well.
  assert.equal(repair(`${base}eu n sei`, '', `${base}eu né não sei`), undefined);
  assert.equal(repair(`${base}falou a gente`, '', `${base}falou ação a gente`), undefined);
  assert.equal(repair(`${base}e a na hoje`, '', `${base}e a nação na hoje`), undefined);
  assert.equal(repair(`${base}x z na y`, '', `${base}x nação z y`), undefined);
  assert.equal(repair(`${base}que a casa`, '', `${base}que é a casa que a casa`), undefined);
  // The clear cases still repair.
  assert.equal(repair(GARBLED, BEFORE, INSIDE, AFTER), REPAIRED);
});

test('hyphens, apostrophes and sentence ends never bring in or move a word', () => {
  assert.equal(repair('a Petrobras investe no pr sal a gente trabalha com peixe aqui no estado de Minas Gerais', '',
    'a Petrobras investe no pré-sal a gente trabalha com peixe aqui no estado de Minas Gerais'), undefined);
  assert.equal(repair("um copo d' gelada a gente trabalha com peixe aqui no estado de Minas Gerais", '',
    "um copo d'água gelada a gente trabalha com peixe aqui no estado de Minas Gerais"), undefined);
  assert.equal(repair('O que? Isso a gente trabalha com peixe aqui no estado de Minas Gerais', '',
    'O que é? Isso a gente trabalha com peixe aqui no estado de Minas Gerais'), undefined);
});
