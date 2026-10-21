import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  analyzeTranscript,
  detectTranscriptFormat,
  formatTimestamp,
  joinTranscriptParts,
  MAX_SEGMENT_CHARS,
  parseTimestamp,
  parseTranscript,
  splitTranscriptParts,
} from './transcript-parse.ts';
import type { ParsedSegment, TranscriptPartText } from './transcript-parse.ts';

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

describe('a material sent in parts', () => {
  const srt = (...cues: [string, string, string][]) =>
    cues.map(([from, to, text], index) => `${index + 1}\n00:${from},000 --> 00:${to},000\n${text}\n`).join('\n');
  const whisperOne = srt(['00:00', '00:04', 'Primeira frase da parte um.'], ['00:05', '00:09', 'Segunda frase da parte um.']);
  const whisperTwo = srt(['00:00', '00:03', 'Primeira frase da parte dois.'], ['00:04', '00:07', 'Segunda frase da parte dois.']);
  const notes = 'Texto livre da entrevista.\n\nSegundo parágrafo das anotações.';
  const parse = (parts: TranscriptPartText[]) => parseTranscript(joinTranscriptParts(parts));

  test('joinTranscriptParts keeps a single recording byte for byte', () => {
    const text = '﻿Ana: Oi.\r\nBia: Olá.\r\n';
    assert.equal(joinTranscriptParts([{ text }]), text);
    assert.equal(joinTranscriptParts([{ text, fileName: 'entrevista.srt' }]), text);
    assert.equal(joinTranscriptParts([]), '');
    assert.equal(splitTranscriptParts(text), undefined);
  });

  test('joined parts split back to the texts that were joined', () => {
    const joined = joinTranscriptParts([{ text: 'Ana: Oi.\r\nBia: Olá.' }, { text: 'Texto \u001c solto.\n' }, { text: '' }]);
    assert.ok(joined.startsWith('\u001c\n'));
    assert.deepEqual(splitTranscriptParts(joined), ['Ana: Oi.\nBia: Olá.', 'Texto  solto.\n', '']);
    assert.deepEqual(splitTranscriptParts(joined.replaceAll('\n', '\r\n')), splitTranscriptParts(joined));
    assert.equal(joinTranscriptParts([{ text: 'a\u001cb' }]), 'ab');
  });

  test('parts are parsed alone: ids run on and part 2 starts where part 1 ends', () => {
    const parsed = parse([{ text: whisperOne, fileName: 'parte-1.srt' }, { text: whisperTwo, fileName: 'parte-2.srt' }]);
    assert.equal(parsed.format, 'srt');
    assert.deepEqual(
      parsed.segments.map((segment) => [segment.id, segment.part, segment.startMs, segment.endMs]),
      [
        ['seg-001', 1, 0, 4_000],
        ['seg-002', 1, 5_000, 9_000],
        ['seg-003', 2, 9_000, 12_000],
        ['seg-004', 2, 13_000, 16_000],
      ],
    );
    assert.deepEqual(parsed.parts, [
      { format: 'srt', segments: 2, startMs: 0, durationMs: 9_000 },
      { format: 'srt', segments: 2, startMs: 9_000, durationMs: 7_000 },
    ]);
    assert.equal(analyzeTranscript(parsed.segments).durationMs, 9_000 + 7_000);
  });

  test('a cue cut at the end of a part never merges with the next part', () => {
    const parsed = parse([
      { text: srt(['00:00', '00:04', 'A conversa continua e']), fileName: 'parte-1.srt' },
      { text: '1\n00:00:00,300 --> 00:00:02,000\ndepois termina.\n', fileName: 'parte-2.srt' },
    ]);
    assert.deepEqual(parsed.segments.map((segment) => [segment.text, segment.part, segment.startMs]), [
      ['A conversa continua e', 1, 0],
      ['depois termina.', 2, 4_300],
    ]);
  });

  test("an unlabeled opening never inherits the previous part's speaker", () => {
    const parsed = parse([{ text: 'Ana: Oi, tudo bem?\nBia: Tudo ótimo.\nAna: Que bom.' }, { text: notes }]);
    const second = parsed.segments.filter((segment) => segment.part === 2);
    assert.equal(second.length, 2);
    assert.ok(second.every((segment) => segment.speaker === undefined));
    assert.deepEqual(parsed.speakers, ['Ana', 'Bia']);
  });

  test('a .srt part and a .txt part keep every line', () => {
    for (const parts of [
      [{ text: whisperOne, fileName: 'parte-1.srt' }, { text: notes, fileName: 'notas.txt' }],
      [{ text: notes, fileName: 'notas.txt' }, { text: whisperOne, fileName: 'parte-1.srt' }],
    ]) {
      const parsed = parse(parts);
      assert.ok(parsed.warnings.every((warning) => warning.code !== 'malformed_cue'));
      const texts = parsed.segments.map((segment) => segment.text);
      for (const line of ['Texto livre da entrevista.', 'Segundo parágrafo das anotações.', 'Primeira frase da parte um.', 'Segunda frase da parte um.']) {
        assert.ok(texts.includes(line), line);
      }
    }
  });

  test('a .vtt without header and a .srt without numbers still read as cues; joining again adds no second header', () => {
    const parts = [
      { text: '00:01.000 --> 00:03.000\nAna: Bom dia.\n\n00:03.500 --> 00:05.000\nBia: Bom dia, Ana.\n', fileName: 'a.vtt' },
      { text: '00:00:01,000 --> 00:00:02,000\nPrimeira fala.\n\n00:00:02,500 --> 00:00:04,000\nSegunda fala.\n', fileName: 'b.srt' },
    ];
    const joined = joinTranscriptParts(parts);
    const parsed = parseTranscript(joined);
    assert.deepEqual(parsed.warnings, []);
    parts.forEach((part, index) => {
      const alone = parseTranscript(part.text, { fileName: part.fileName }).segments.map((segment) => segment.text);
      assert.deepEqual(parsed.segments.filter((segment) => segment.part === index + 1).map((segment) => segment.text), alone);
    });
    const again = splitTranscriptParts(joined)?.map((text, index) => ({ text, fileName: parts[index].fileName })) ?? [];
    assert.equal(joinTranscriptParts(again), joined);
  });

  test('a .srt holding .vtt cues reads in a material as it reads alone', () => {
    const cues = '00:00:01.000 --> 00:00:03.000\n<v Ana>Bom dia a todos.\n\n00:00:03.500 --> 00:00:05.000\n<v Beto>Bom dia, Ana.\n';
    const fields = (segments: ParsedSegment[]) => segments.map((segment) => [segment.id, segment.speaker, segment.text, segment.startMs, segment.endMs]);
    for (const text of [`WEBVTT\n\n${cues}`, cues]) {
      const parts = [{ text, fileName: 'REC_0012.srt' }, { text: notes, fileName: 'notas.txt' }];
      const joined = parse(parts);
      assert.deepEqual(fields(joined.segments.filter((segment) => segment.part === 1)), fields(parseTranscript(text, { fileName: 'REC_0012.srt' }).segments));
      assert.deepEqual(joined.speakers, []);
      const again = splitTranscriptParts(joinTranscriptParts(parts))?.map((cleaned, index) => ({ text: cleaned, fileName: parts[index].fileName })) ?? [];
      assert.equal(joinTranscriptParts(again), joinTranscriptParts(parts));
    }
  });

  test('an untimed part adds no time', () => {
    const parsed = parse([{ text: whisperOne, fileName: 'parte-1.srt' }, { text: 'Texto sem tempo.' }, { text: whisperTwo, fileName: 'parte-3.srt' }]);
    const middle = parsed.segments.filter((segment) => segment.part === 2);
    assert.ok(middle.length > 0 && middle.every((segment) => segment.startMs === undefined && segment.endMs === undefined));
    assert.deepEqual(parsed.parts?.[1], { format: 'plain', segments: 1 });
    assert.equal(parsed.parts?.[2].startMs, 9_000);
    assert.equal(parsed.segments.find((segment) => segment.part === 3)?.startMs, 9_000);
  });

  test('speakers are merged in order; warnings carry their part; empty and no_speakers are computed once', () => {
    const labeled = ['1', '00:00:01,000 --> 00:00:03,000', 'Caio: Fala um.', '', '2', '00:00:04,000 --> 00:00:06,000', 'Bia: Fala dois.', '', 'sem tempo', 'texto solto'].join('\n');
    const mixed = parse([{ text: 'Ana: Oi.\nBia: Olá.' }, { text: labeled }, { text: '' }]);
    assert.deepEqual(mixed.speakers, ['Ana', 'Bia', 'Caio']);
    assert.deepEqual(mixed.warnings, [
      { code: 'malformed_cue', message: 'Trecho sem marcação de tempo foi ignorado.', line: 9, part: 2 },
      { code: 'empty', message: 'A parte 3 não tem falas.', part: 3 },
    ]);
    assert.deepEqual(mixed.parts?.[2], { format: 'plain', segments: 0 });
    assert.deepEqual(parse([{ text: 'Primeiro texto.' }, { text: 'Segundo texto.' }]).warnings, parseTranscript('Um texto.').warnings);
    const empty = parse([{ text: '' }, { text: '  ' }]);
    assert.deepEqual(empty.warnings.map((warning) => [warning.code, warning.part]), [['empty', 1], ['empty', 2], ['empty', undefined]]);
  });

  test('an envelope ignores fileName and format options', () => {
    const joined = joinTranscriptParts([{ text: whisperOne, fileName: 'parte-1.srt' }, { text: notes }]);
    assert.deepEqual(parseTranscript(joined, { fileName: 'x.srt', format: 'srt' }), parseTranscript(joined));
  });

  test('reordering parts renumbers ids; the same order parses the same', () => {
    const one = { text: whisperOne, fileName: 'parte-1.srt' };
    const two = { text: whisperTwo, fileName: 'parte-2.srt' };
    const forward = parse([one, two]);
    const backward = parse([two, one]);
    assert.deepEqual(forward, parse([one, two]));
    assert.deepEqual(backward.segments.map((segment) => segment.id), forward.segments.map((segment) => segment.id));
    assert.equal(backward.segments[0].text, 'Primeira frase da parte dois.');
    assert.deepEqual(backward.parts?.map((part) => part.startMs), [0, 7_000]);
  });
});
