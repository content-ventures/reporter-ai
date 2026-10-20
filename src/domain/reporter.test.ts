import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptedRepair, garbledSegment, repairWindow, wordsWithin, type TimedWord } from './reporter.ts';

// What Whisper returned for 88–105 s of a real stand interview: every word cut at its first accent.
const GARBLED = 'Ent eu trouxe alguns panoramas como por exemplo compara com outras esp su aves e tamb salmonicultura de quanto n estamos em distribui de custos ou seja quanto ra quanto sanidade quanto gen e pra mostrar que sim n estamos no caminho certo existe uma evolu';
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

test('only the words spoken inside the segment replace it, by the middle of each word', () => {
  // Window from 84 s; times relative to it.
  const words: TimedWord[] = [
    { word: 'prazo.', start_ms: 3600, end_ms: 4000 },
    { word: 'Então', start_ms: 4400, end_ms: 4700 }, { word: 'eu', start_ms: 4700, end_ms: 4800 },
    { word: 'trouxe', start_ms: 4800, end_ms: 5100 }, { word: 'evolução', start_ms: 21_000, end_ms: 21_500 },
    { word: 'para', start_ms: 21_700, end_ms: 21_900 },
  ];
  assert.equal(wordsWithin(words, 84, segment), 'Então eu trouxe evolução');
});

test('a repair is kept only when it reads as Portuguese again at about the same length', () => {
  const repaired = 'Então eu trouxe alguns panoramas, como por exemplo, comparação com outras espécies, suínos, aves e também salmonicultura, de quanto nós estamos em distribuição de custos, ou seja, quanto é ração, quanto é sanidade, quanto é genética, e para mostrar que sim, nós estamos no caminho certo, existe uma evolução';
  assert.equal(acceptedRepair(GARBLED, repaired), true);
  assert.equal(acceptedRepair(GARBLED, GARBLED), false, 'the same failure again is not a repair');
  assert.equal(acceptedRepair(GARBLED, 'Então eu trouxe alguns panoramas.'), false, 'a much shorter text loses speech');
  assert.equal(acceptedRepair(GARBLED, `${repaired} ${repaired}`), false, 'a much longer text adds speech');
});
