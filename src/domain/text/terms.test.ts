import assert from 'node:assert/strict';
import { test } from 'node:test';
import { correctTerm, replaceTerm, termOccurrences } from './terms.ts';

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

test('stamps inside the speech, wrapped lines and decomposed accents are handled like the parser reads them', () => {
  // A number never touches a "[00:04:12] Nome:" stamp, so the line keeps its time and speaker.
  const lines = '[00:04:12] Rafael Dias: E as cores? O que muda na cartela de 04 tons?';
  assert.equal(termOccurrences(lines, '04'), 1);
  assert.equal(replaceTerm(lines, '04', 'quatro').text, '[00:04:12] Rafael Dias: E as cores? O que muda na cartela de quatro tons?');
  // A cue wrapped over two lines is one stretch of speech.
  const wrapped = '1\n00:00:00,000 --> 00:00:04,000\nBom, falando sobre a vinda para a Q\nShow deste ano.';
  assert.equal(termOccurrences(wrapped, 'Q Show'), 1);
  assert.match(replaceTerm(wrapped, 'Q Show', 'Aquishow').text, /para a Aquishow deste ano\./u);
  // A decomposed "José" is one word: "Jose" does not match its start, "José" matches it.
  const decomposed = 'Bom, falando de José e de Santa Fé.'.normalize('NFD');
  assert.equal(termOccurrences(decomposed, 'Jose'), 0);
  assert.equal(replaceTerm(decomposed, 'José', 'Josué').text, 'Bom, falando de Josué e de Santa Fé.');
  assert.equal(replaceTerm('WEBVTT\n\n00:00.000 --> 00:04.000\nA WEBVTT dele.', 'WEBVTT', 'X').count, 1, 'the header stays, the speech changes');
});

test('a correction that would change who speaks or the times is refused; a plain name fix goes through', () => {
  const lines = 'Ana Souza: Bom dia.\nRafael: Bom dia, Ana.\nAna Souza: Qual o objetivo?\nRafael: Crescer 20%.';
  // Names the label rules do not read would hand Rafael's lines to Ana.
  assert.deepEqual(correctTerm(lines, 'Rafael', "Rafael d'Ávila"), { refused: 'structure', count: 2 });
  assert.deepEqual(correctTerm(lines, 'Rafael', 'Rafael du Pont'), { refused: 'structure', count: 2 });
  const renamed = correctTerm(lines, 'Rafael', 'Rafael Silva');
  assert.equal(renamed.refused, undefined);
  assert.equal(renamed.count, 2);
  // Bare mm:ss stamps are times, not words: only the speech changes and every line keeps its speaker.
  const stamped = '04:12 - Rafael Dias: A cartela tem 04 tons.\n04:30 - Ana Souza: E 12 cores?\n05:12 - Rafael Dias: Sim, 12.';
  const twelve = correctTerm(stamped, '12', 'doze');
  assert.equal(twelve.count, 2);
  assert.equal(twelve.refused, undefined);
  assert.match(!twelve.refused ? twelve.text : '', /^04:12 - Rafael Dias: A cartela tem 04 tons\.$/mu);
  const otter = correctTerm('Rafael Dias  04:12\nA cartela tem 04 tons.', '04', 'quatro');
  assert.equal(otter.refused, undefined);
  assert.equal(!otter.refused ? otter.text : '', 'Rafael Dias  04:12\nA cartela tem quatro tons.');
  // The stand case: the event name is fixed and nothing else moves.
  assert.equal(correctTerm(SRT, 'Q Show', 'Aquishow').count, 3);
});

test('a name fix that only regroups unlabeled cues by size is accepted', () => {
  const cue = (at: number, text: string) => `${at + 1}\n00:00:${String(at * 5).padStart(2, '0')},000 --> 00:00:${String(at * 5 + 5).padStart(2, '0')},000\n${text}`;
  const words = 'e a gente acompanha o mercado de perto com os clientes do setor todo dia sem parar nunca';
  const srt = [cue(0, `a Q Show reuniu ${words}`), ...Array.from({ length: 7 }, (_, at) => cue(at + 1, words))].join('\n\n');
  const fixed = correctTerm(srt, 'Q Show', 'Aquishow Brasil Seafood Show Latin America');
  assert.equal(fixed.refused, undefined);
  assert.equal(fixed.count, 1);
});

test('fixing a name to a longer one leaves the right name where it already is', () => {
  const lines = 'Rafael Dias: Bom dia.\nAna Souza: Obrigada, Rafael.\nRafael Dias: Vamos lá.';
  const fixed = correctTerm(lines, 'Rafael', 'Rafael Dias');
  assert.equal(fixed.refused, undefined);
  assert.equal(fixed.count, 1);
  assert.equal(!fixed.refused ? fixed.text : '', 'Rafael Dias: Bom dia.\nAna Souza: Obrigada, Rafael Dias.\nRafael Dias: Vamos lá.');
  assert.equal(termOccurrences(lines, 'Rafael', 'Rafael Dias'), 1);
  assert.equal(replaceTerm('Bem-vindos à Brasil Seafood Show. A Seafood Show deste ano cresceu.', 'Seafood Show', 'Brasil Seafood Show').text,
    'Bem-vindos à Brasil Seafood Show. A Brasil Seafood Show deste ano cresceu.');
});

test('a two-word term never swallows the next line\'s speaker, and a case-only fix is applied', () => {
  const lines = 'Dias: Quem responde é a Ana\nSouza: Eu respondo.\nSouza: E completo.\nDias: Obrigado.';
  assert.equal(termOccurrences(lines, 'Ana Souza'), 0, 'in "Nome: fala" text each line is its own turn');
  assert.equal(correctTerm(lines, 'Ana Souza', 'Ana Sousa').count, 0);
  const srt = '1\n00:00:00,000 --> 00:00:04,000\nA msd veio para a aquishow.\n\n2\n00:00:04,000 --> 00:00:08,000\nA Msd trouxe a vacina.';
  assert.equal(termOccurrences(srt, 'msd', 'MSD'), 2);
  const fixed = correctTerm(srt, 'msd', 'MSD');
  assert.equal(fixed.count, 2);
  assert.match(!fixed.refused ? fixed.text : '', /A MSD veio para a aquishow\.[\s\S]*A MSD trouxe a vacina\./u);
  assert.equal(termOccurrences('A MSD e a MSD.', 'msd', 'MSD'), 0, 'already right, nothing to change');
});

test('shortening a name applies, extra spaces are cleaned, and a line that would change speaker is refused', () => {
  const lines = 'Lucas Ferraz: Bom dia.\nAna Souza: Oi, Lucas Ferraz.\nLucas Ferraz: Vamos lá.';
  assert.equal(termOccurrences(lines, 'Lucas Ferraz', 'Lucas'), 3);
  assert.equal(correctTerm(lines, 'Lucas Ferraz', 'Lucas').count, 3);
  const spaced = correctTerm(lines, 'Lucas Ferraz', 'Lucas  Ferraz Rocha');
  assert.equal(spaced.refused, undefined);
  assert.match(!spaced.refused ? spaced.text : '', /^Lucas Ferraz Rocha: Bom dia\.$/mu);
  // "rafael dias:" in lowercase is Beatriz's speech; fixing its case would hand the line to Rafael.
  const turns = 'Rafael Dias: Qual o objetivo?\nBeatriz Almeida: Crescer na feira.\nrafael dias: E a cor do verão?\nRafael Dias: Pode responder, Beatriz.\nBeatriz Almeida: Verde.';
  assert.equal(correctTerm(turns, 'rafael dias', 'Rafael Dias').refused, 'structure');
});

test('a name split across two Whisper cues does not block the other corrections', () => {
  const srt = '1\n00:00:00,000 --> 00:00:03,000\nObrigado por vir para a Q\n\n2\n00:00:03,000 --> 00:00:06,000\nShow deste ano.\n\n3\n00:00:06,000 --> 00:00:09,000\nA Q Show é a maior feira do setor.';
  const fixed = correctTerm(srt, 'Q Show', 'Aquishow');
  assert.equal(fixed.refused, undefined);
  assert.equal(fixed.count, 1);
});

test('names split by line breaks, cues or tags do not block a fix; a blank line between cues is never crossed', () => {
  const wrapped = 'Rafael Dias: O Q Show abriu hoje.\nBeatriz Almeida: O Q Show tem 300 marcas e o\nQ Show cresceu.\nBeatriz Almeida: Eu que agradeço ao Q\nShow.';
  const fixed = correctTerm(wrapped, 'Q Show', 'Aquishow');
  assert.equal(fixed.refused, undefined);
  assert.equal(fixed.count, 3, 'the name split over a line break in "Nome: fala" text stays as it was');
  assert.equal(correctTerm('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nO <i>Q Show</i> e o Q <i>Show</i> cresceram.', 'Q Show', 'Aquishow').refused, undefined);
  // A cue identifier after a blank line is not speech: the term never reaches into it.
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nBem-vindos ao Q\n\nShow abertura\n00:00:03.000 --> 00:00:05.000\nque reúne 300 marcas.\n';
  assert.equal(correctTerm(vtt, 'Q Show', 'Aquishow').count, 0);
});

test('a name glued to another word by a slash, a hyphen or a dot does not block the fix', () => {
  const srt = '1\n00:00:00,000 --> 00:00:04,000\nA msd veio para a feira, a msd/Merck trouxe a vacina.\n\n2\n00:00:04,000 --> 00:00:08,000\nA msd cresceu.';
  const fixed = correctTerm(srt, 'msd', 'MSD');
  assert.equal(fixed.refused, undefined);
  assert.equal(fixed.count, 3);
  assert.equal(correctTerm('Rafael Dias: O Q Show abriu hoje?\nBeatriz Almeida: Sim. O pós-Q Show também conta.', 'Q Show', 'Aquishow').refused, undefined);
  assert.equal(correctTerm('Beatriz Almeida: A aquishow abre amanhã, inscrições em aquishow.com.br.', 'aquishow', 'Aquishow').refused, undefined);
});
