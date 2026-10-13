import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  analyzeTranscript,
  detectTranscriptFormat,
  formatTimestamp,
  MAX_SEGMENT_CHARS,
  parseTimestamp,
  parseTranscript,
} from './transcript-parse.ts';

describe('timestamps', () => {
  test('parse mm:ss, h:mm:ss and fractions with comma or dot', () => {
    assert.equal(parseTimestamp('00:12'), 12_000);
    assert.equal(parseTimestamp('1:02:03'), 3_723_000);
    assert.equal(parseTimestamp('00:00:01,5'), 1_500);
    assert.equal(parseTimestamp('00:01.250'), 1_250);
    assert.equal(parseTimestamp('12:75'), undefined);
    assert.equal(parseTimestamp('abc'), undefined);
    assert.equal(formatTimestamp(3_723_000), '1:02:03');
    assert.equal(formatTimestamp(65_000), '01:05');
  });
});

describe('"Nome: fala" transcripts', () => {
  test('turns labelled lines into speakers and segments with stable ids', () => {
    const parsed = parseTranscript(
      [
        'Entrevistadora: Como começou o Ateliê Sul?',
        'Marina Lopes: Começamos numa garagem em 2015.',
        'Era um espaço pequeno, mas suficiente.',
        '',
        'Entrevistadora: E depois?',
        'Marina Lopes: A feira mudou tudo.',
      ].join('\n'),
    );
    assert.equal(parsed.format, 'speaker-lines');
    assert.deepEqual(parsed.speakers, ['Entrevistadora', 'Marina Lopes']);
    assert.deepEqual(
      parsed.segments.map((segment) => [segment.id, segment.speaker, segment.text]),
      [
        ['seg-001', 'Entrevistadora', 'Como começou o Ateliê Sul?'],
        ['seg-002', 'Marina Lopes', 'Começamos numa garagem em 2015. Era um espaço pequeno, mas suficiente.'],
        ['seg-003', 'Entrevistadora', 'E depois?'],
        ['seg-004', 'Marina Lopes', 'A feira mudou tudo.'],
      ],
    );
    assert.deepEqual(parsed.warnings, []);
  });

  test('reads timestamps before or after the label, and lowercase name particles', () => {
    const parsed = parseTranscript(
      ['[00:01:05] Maria da Silva: Primeira fala.', 'Pedro (02:10): Segunda fala.', '00:03:00 - Maria da Silva: Terceira.', 'Pedro: Quarta.'].join('\n'),
    );
    assert.deepEqual(parsed.speakers, ['Maria da Silva', 'Pedro']);
    assert.deepEqual(
      parsed.segments.map((segment) => [segment.speaker, segment.startMs]),
      [
        ['Maria da Silva', 65_000],
        ['Pedro', 130_000],
        ['Maria da Silva', 180_000],
        ['Pedro', undefined],
      ],
    );
  });

  test('a label seen once among repeated speakers stays as text, not a speaker', () => {
    const parsed = parseTranscript(
      ['Ana: Oi.', 'Bruno: Olá.', 'Ana: Tudo bem?', 'Bruno: Sim.', 'Observação: isto é uma nota dentro da fala.'].join('\n'),
    );
    assert.deepEqual(parsed.speakers, ['Ana', 'Bruno']);
    assert.equal(parsed.segments[3].text, 'Sim. Observação: isto é uma nota dentro da fala.');
  });

  test('Otter-style headers ("Nome  0:03" then text) become speaker segments', () => {
    const parsed = parseTranscript(['Marina Lopes  0:03', 'Começamos numa garagem.', '', 'Entrevistadora  0:10', 'E depois?'].join('\n'));
    assert.deepEqual(
      parsed.segments.map((segment) => [segment.speaker, segment.text, segment.startMs]),
      [
        ['Marina Lopes', 'Começamos numa garagem.', 3_000],
        ['Entrevistadora', 'E depois?', 10_000],
      ],
    );
  });

  test('never invents timestamps or speakers for plain prose', () => {
    const parsed = parseTranscript('Primeiro parágrafo da conversa.\n\nSegundo parágrafo: com dois pontos no meio.');
    assert.equal(parsed.format, 'plain');
    assert.deepEqual(parsed.speakers, []);
    assert.deepEqual(parsed.segments.map((segment) => segment.text), ['Primeiro parágrafo da conversa.', 'Segundo parágrafo: com dois pontos no meio.']);
    assert.ok(parsed.segments.every((segment) => segment.startMs === undefined && segment.speaker === undefined));
    assert.equal(parsed.warnings[0].code, 'no_speakers');
  });

  test('splits over-long answers at sentence boundaries without losing text', () => {
    const sentence = 'O couro reaproveitado virou o centro do negócio da família. ';
    const answer = sentence.repeat(40).trim();
    const parsed = parseTranscript(`Marina: ${answer}\nAna: Certo.\nMarina: Sim.\nAna: Fim.`);
    const marina = parsed.segments.filter((segment) => segment.speaker === 'Marina');
    assert.ok(marina.length > 2);
    assert.ok(parsed.segments.every((segment) => segment.text.length <= MAX_SEGMENT_CHARS));
    assert.equal(
      marina
        .slice(0, -1)
        .map((segment) => segment.text)
        .join(' '),
      answer,
    );
    assert.equal(new Set(parsed.segments.map((segment) => segment.id)).size, parsed.segments.length);
  });

  test('empty material yields a warning and no segments', () => {
    const parsed = parseTranscript('   \n\n  ');
    assert.deepEqual(parsed.segments, []);
    assert.equal(parsed.warnings[0].code, 'empty');
  });
});

describe('SRT', () => {
  const srt = [
    '1',
    '00:00:01,000 --> 00:00:03,000',
    'Marina: Começamos numa garagem',
    '',
    '2',
    '00:00:03,200 --> 00:00:05,000',
    'em 2015, com duas máquinas.',
    '',
    '3',
    '00:00:06,000 --> 00:00:08,000',
    'Entrevistadora: E depois?',
    '',
    'sem tempo',
    'texto solto',
    '',
  ].join('\n');

  test('detects the format, merges consecutive cues of a speaker and keeps timings', () => {
    assert.equal(detectTranscriptFormat(srt), 'srt');
    const parsed = parseTranscript(srt);
    assert.equal(parsed.format, 'srt');
    assert.deepEqual(
      parsed.segments.map((segment) => [segment.speaker, segment.text, segment.startMs, segment.endMs]),
      [
        ['Marina', 'Começamos numa garagem em 2015, com duas máquinas.', 1_000, 5_000],
        ['Entrevistadora', 'E depois?', 6_000, 8_000],
      ],
    );
    assert.equal(parsed.warnings.filter((warning) => warning.code === 'malformed_cue').length, 1);
  });

  test('unlabelled cues merge until a sentence ends', () => {
    const parsed = parseTranscript(
      ['1', '00:00:01,000 --> 00:00:02,000', 'Primeira parte', '', '2', '00:00:02,100 --> 00:00:03,000', 'da frase.', '', '3', '00:00:03,100 --> 00:00:04,000', 'Outra frase.'].join('\n'),
      { fileName: 'entrevista.srt' },
    );
    assert.deepEqual(parsed.segments.map((segment) => segment.text), ['Primeira parte da frase.', 'Outra frase.']);
    assert.equal(parsed.segments[0].endMs, 3_000);
  });
});

describe('WebVTT', () => {
  test('reads voice tags, strips markup and skips NOTE blocks', () => {
    const vtt = [
      'WEBVTT - Entrevista',
      '',
      'NOTE gerado automaticamente',
      '',
      'cue-1',
      '00:01.000 --> 00:04.000 align:start',
      '<v Marina Lopes>A feira <i>mudou</i> tudo &amp; mais.</v>',
      '',
      '00:04.500 --> 00:06.000',
      '<v.entrevistadora Ana>E agora?',
    ].join('\n');
    assert.equal(detectTranscriptFormat(vtt), 'vtt');
    const parsed = parseTranscript(vtt);
    assert.deepEqual(
      parsed.segments.map((segment) => [segment.speaker, segment.text, segment.startMs, segment.endMs]),
      [
        ['Marina Lopes', 'A feira mudou tudo & mais.', 1_000, 4_000],
        ['Ana', 'E agora?', 4_500, 6_000],
      ],
    );
    assert.deepEqual(parsed.speakers, ['Marina Lopes', 'Ana']);
  });
});

describe('analyzeTranscript', () => {
  test('summarises words, speakers and timing', () => {
    const parsed = parseTranscript('[00:10] Ana: Um dois três.\n[00:20] Bia: Quatro.\nAna: Cinco seis.');
    const analysis = analyzeTranscript(parsed.segments);
    assert.equal(analysis.words, 6);
    assert.equal(analysis.segments, 3);
    assert.equal(analysis.hasTimestamps, true);
    assert.equal(analysis.durationMs, 20_000);
    assert.deepEqual(analysis.speakers, [
      { label: 'Ana', segments: 2, words: 5 },
      { label: 'Bia', segments: 1, words: 1 },
    ]);
  });
});
