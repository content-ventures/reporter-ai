import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MAX_MATERIAL_CHARS, analyzeTranscript, joinTranscriptParts, parseTranscript, sourceContentHash } from '../../domain/index.ts';
import type { SourceAnalysis } from '../../ports/index.ts';
import {
  EMPTY_DRAFT,
  EMPTY_EVENT,
  NEW_PRODUCTION_STEPS,
  RECEIVED_PART,
  addParts,
  draftMaterial,
  dropPart,
  landPart,
  materialTooLong,
  movePart,
  withMaterialText,
  draftAutomaticSections,
  draftSectionOptions,
  draftStructureLabel,
  eventDraft,
  withFormat,
  withFormatSize,
  STEP_LABELS,
  analysisLine,
  briefBlocker,
  briefSummary,
  defaultTitle,
  isDraftDirty,
  materialBlocker,
  sectionOptions,
  shortfallSentence,
  speakersWithoutPerson,
  structureChoiceLabel,
  suggestSpeaker,
  toCreateInput,
  validateMaterial,
  withSize,
  withoutPersonLabel,
} from './form.ts';
import type { MaterialPart, NewProductionDraft } from './form.ts';
import { SAMPLE_NEW_SPEAKER, SAMPLE_TRANSCRIPT } from './sample-material.ts';

const PEOPLE = [
  { id: 'person-rafael', name: 'Rafael Dias' },
  { id: 'person-beatriz', name: 'Beatriz Almeida' },
  { id: 'person-pedro', name: 'Pedro' },
];

function analysisOf(text: string): SourceAnalysis {
  const parsed = parseTranscript(text);
  const stats = analyzeTranscript(parsed.segments);
  return {
    format: parsed.format,
    hash: sourceContentHash({ type: 'transcript', format: parsed.format, segments: parsed.segments }),
    segments: parsed.segments,
    speakers: stats.speakers,
    stats: {
      words: stats.words,
      characters: text.length,
      readingMinutes: stats.readingMinutes,
      segments: stats.segments,
      hasTimestamps: stats.hasTimestamps,
    },
    preview: parsed.segments.slice(0, 6),
    warnings: parsed.warnings,
    short: stats.words < 300,
  };
}

const sample: NewProductionDraft = { ...EMPTY_DRAFT, pasted: SAMPLE_TRANSCRIPT, title: 'Tendências' };

describe('Nova produção form', () => {
  test('the sample material has three speakers and enough words to generate', () => {
    const analysis = analysisOf(SAMPLE_TRANSCRIPT);
    assert.deepEqual(
      analysis.speakers.map((speaker) => speaker.label),
      ['Rafael Dias', 'Beatriz Almeida', SAMPLE_NEW_SPEAKER],
    );
    assert.equal(analysis.short, false);
    assert.ok(analysis.stats.hasTimestamps);
  });

  test('two steps: Material and Pauta', () => {
    assert.deepEqual(NEW_PRODUCTION_STEPS.map((step) => STEP_LABELS[step]), ['Material', 'Pauta']);
  });

  test('speakers link to the one matching person, a new person, or wait for a decision', () => {
    assert.deepEqual(suggestSpeaker('Rafael Dias', PEOPLE), { kind: 'person', personId: 'person-rafael' });
    assert.deepEqual(suggestSpeaker('beatriz', PEOPLE), { kind: 'person', personId: 'person-beatriz' });
    assert.deepEqual(suggestSpeaker('Lucas Ferraz', PEOPLE), { kind: 'new', name: 'Lucas Ferraz' });
    assert.deepEqual(suggestSpeaker('Entrevistadora', PEOPLE), { kind: 'unset' });
    assert.deepEqual(suggestSpeaker('R.', PEOPLE), { kind: 'unset' });
  });

  test('"Continuar" says why it is blocked: material first, then the authorisation', () => {
    assert.equal(materialBlocker(EMPTY_DRAFT), 'Cole a transcrição para continuar.');
    assert.equal(materialBlocker({ ...EMPTY_DRAFT, mode: 'file' }), 'Envie o arquivo da transcrição para continuar.');
    assert.equal(materialBlocker({ ...EMPTY_DRAFT, mode: 'link' }), 'Importe o link para continuar.');
    assert.equal(materialBlocker(sample), 'Marque a autorização dos falantes para continuar.');
    assert.equal(materialBlocker({ ...sample, authorized: true }), undefined);
  });

  test('"Gerar artigo" needs an internal title and a section count the size accepts', () => {
    assert.equal(briefBlocker(EMPTY_DRAFT), 'Dê um título interno.');
    assert.equal(briefBlocker(sample), undefined);
    assert.equal(briefBlocker({ ...sample, size: 'short', sections: 4 }), 'Curto aceita de 1 a 3 partes.');
    assert.equal(briefBlocker({ ...sample, sections: 6 }), 'Padrão aceita de 2 a 5 seções.');
  });

  test('Material validation lists the transcript and the new-person names in screen order', () => {
    assert.deepEqual(
      validateMaterial(EMPTY_DRAFT, undefined, PEOPLE).map((issue) => issue.field),
      ['material'],
    );
    const analysis = analysisOf(SAMPLE_TRANSCRIPT);
    const unnamed = { ...sample, speakers: { [SAMPLE_NEW_SPEAKER]: { kind: 'new' as const, name: ' ' } } };
    assert.deepEqual(validateMaterial(unnamed, analysis, PEOPLE).map((issue) => issue.field), [`speaker:${SAMPLE_NEW_SPEAKER}`]);
    assert.deepEqual(validateMaterial(sample, analysis, PEOPLE), []);
  });

  test('"Continuar" asks who every speaker is; "Sem atribuição" is a valid answer (A07)', () => {
    const transcript = 'Entrevistadora: Como começou?\nR.: Começou com uma máquina de costura na garagem e três clientes do bairro.';
    const analysis = analysisOf(transcript);
    const draft: NewProductionDraft = { ...EMPTY_DRAFT, pasted: transcript, title: 'Entrevista' };
    assert.deepEqual(speakersWithoutPerson(draft, analysis, PEOPLE), ['Entrevistadora', 'R.']);
    assert.equal(withoutPersonLabel(2), '2 falantes sem pessoa');
    const issues = validateMaterial(draft, analysis, PEOPLE);
    assert.deepEqual(issues.map((issue) => [issue.field, issue.unattributed]), [['speaker:Entrevistadora', true], ['speaker:R.', true]]);
    const decided: NewProductionDraft = {
      ...draft,
      speakers: { Entrevistadora: { kind: 'none' }, 'R.': { kind: 'new', name: 'Rosa Antunes', title: 'fundadora', organization: 'Ateliê Rosa' } },
    };
    assert.deepEqual(validateMaterial(decided, analysis, PEOPLE), []);
    assert.deepEqual(toCreateInput(decided, analysis, PEOPLE).speakers, [
      { label: 'Entrevistadora', unattributed: true },
      { label: 'R.', newPerson: { name: 'Rosa Antunes', title: 'fundadora', organization: 'Ateliê Rosa' } },
    ]);
  });

  test('the command input carries speakers, brief and plan', () => {
    const analysis = analysisOf(SAMPLE_TRANSCRIPT);
    const draft: NewProductionDraft = {
      ...sample,
      angle: '  Foco no lojista  ',
      recordedOn: '2026-10-05',
      plan: 'article',
      speakers: { 'Rafael Dias': { kind: 'none' } },
    };
    const input = toCreateInput(draft, analysis, PEOPLE);
    assert.equal(input.title, 'Tendências');
    assert.equal(input.material.recordedOn, '2026-10-05');
    assert.equal(input.material.authorized, false);
    assert.deepEqual(input.speakers, [
      { label: 'Rafael Dias', unattributed: true },
      { label: 'Beatriz Almeida', personId: 'person-beatriz' },
      { label: SAMPLE_NEW_SPEAKER, newPerson: { name: SAMPLE_NEW_SPEAKER } },
    ]);
    assert.deepEqual(input.brief, { sections: 3, size: 'standard', angle: 'Foco no lojista' });
    assert.deepEqual(input.plan, ['article']);
  });

  test('a new production starts as Padrão with an automatic 3-section structure; the choices follow the size', () => {
    assert.equal(EMPTY_DRAFT.size, 'standard');
    assert.equal(EMPTY_DRAFT.sections, 3);
    assert.equal(EMPTY_DRAFT.sectionsCustom, false);
    assert.deepEqual(sectionOptions('short'), ['1', '2', '3']);
    assert.deepEqual(sectionOptions('standard'), ['2', '3', '4', '5']);
    assert.equal(structureChoiceLabel('standard', 3, false), 'Automático: introdução + 3 seções');
    assert.equal(structureChoiceLabel('short', 2, false), 'Automático: introdução + 2 partes');
    assert.equal(structureChoiceLabel('standard', 4, true), 'Introdução + 4 seções');
  });

  test('changing the size follows the automatic count, or fits a chosen one and says so', () => {
    assert.deepEqual(withSize(EMPTY_DRAFT, 'short'), { size: 'short', sections: 2 });
    const chosen = { sections: 5, sectionsCustom: true };
    assert.deepEqual(withSize(chosen, 'short'), {
      size: 'short',
      sections: 3,
      notice: 'Curto aceita até 3 partes: ajustado para 3.',
    });
    assert.deepEqual(withSize({ sections: 3, sectionsCustom: true }, 'standard'), { size: 'standard', sections: 3 });
  });

  test('a material that cannot fill the size says so, never padded', () => {
    assert.equal(shortfallSentence('standard', undefined), undefined);
    assert.equal(shortfallSentence('standard', 6000), undefined);
    assert.match(shortfallSentence('standard', 800) ?? '', /^O material rende ≈ .* lauda\. Acrescente fonte para cumprir o mínimo/);
  });

  test('the summaries read "Padrão · 2 laudas · 3 seções · 2 falantes"', () => {
    assert.equal(briefSummary('standard', 3, 2), 'Padrão · 2 laudas · 3 seções · 2 falantes');
    assert.equal(briefSummary('short', 2, 1), 'Curto · 1 lauda · 2 partes · 1 falante');
    assert.equal(briefSummary('standard', 3, 0), 'Padrão · 2 laudas · 3 seções');
    assert.equal(analysisLine({ speakers: [{ label: 'A' }, { label: 'B' }] as SourceAnalysis['speakers'], stats: { segments: 36 } as SourceAnalysis['stats'] }, '16:48'), '36 falas · 2 falantes · 16:48');
  });

  test('the default title names the first guest (not the newsroom), else the first named speaker', () => {
    const analysis = analysisOf(SAMPLE_TRANSCRIPT);
    assert.equal(defaultTitle({ speakers: {} }, undefined, PEOPLE), 'Nova entrevista');
    assert.equal(defaultTitle({ speakers: {} }, analysis, PEOPLE), 'Entrevista com Rafael Dias');
    assert.equal(defaultTitle({ speakers: {} }, analysis, PEOPLE, (personId) => personId === 'person-rafael'), 'Entrevista com Beatriz Almeida');
    assert.equal(
      defaultTitle({ speakers: { 'Rafael Dias': { kind: 'none' }, 'Beatriz Almeida': { kind: 'none' } } }, analysis, PEOPLE),
      `Entrevista com ${SAMPLE_NEW_SPEAKER}`,
    );
  });

  test('a material-grounded topic takes precedence over the generic interview title', () => {
    const analysis = analysisOf(SAMPLE_TRANSCRIPT);
    analysis.topicTitle = 'Gestão do mix de pescados no varejo';
    assert.equal(defaultTitle({ speakers: {} }, analysis, PEOPLE), analysis.topicTitle);
  });

  test('helpers: dirty flag', () => {
    assert.equal(isDraftDirty(EMPTY_DRAFT), false);
    assert.equal(isDraftDirty({ ...EMPTY_DRAFT, title: 'x' }), true);
    assert.equal(isDraftDirty({ ...EMPTY_DRAFT, size: 'short' }), true);
  });
});

describe('Nova produção · event formats', () => {
  test('choosing a format brings its default size and sections; the article comes back unchanged', () => {
    const stand = { ...sample, ...withFormat('stand') };
    assert.equal(stand.formatSize, 'full');
    assert.equal(stand.sections, 2);
    assert.deepEqual(draftSectionOptions(stand), ['2', '3']);
    assert.equal(draftStructureLabel(stand, 2, false), 'Automático: abertura + 2 seções');
    assert.equal(draftAutomaticSections({ ...sample, ...withFormat('note') }), 1);
    assert.equal(draftStructureLabel({ ...sample, ...withFormat('note') }, 1, true), 'Abertura + 1 parte');
    const back = { ...stand, ...withFormat(undefined) };
    assert.equal(back.format, undefined);
    assert.equal(back.sections, 3);
    assert.ok(isDraftDirty(stand));
  });

  test('a chosen section count is fitted when the format size changes', () => {
    const stand = { ...sample, ...withFormat('stand'), sections: 3, sectionsCustom: true };
    assert.deepEqual(withFormatSize(stand, 'compact'), { formatSize: 'compact', sections: 2 });
    assert.deepEqual(withFormatSize({ ...stand, sectionsCustom: false }, 'compact'), { formatSize: 'compact', sections: 1 });
  });

  test('the command input carries the format, its size and the named event only', () => {
    const analysis = analysisOf(SAMPLE_TRANSCRIPT);
    const draft: NewProductionDraft = { ...sample, ...withFormat('stand'), formatSize: 'compact', sections: 1,
      event: { ...EMPTY_EVENT, name: ' Seafood Show Latin America 2026 ', dates: 'De 20 a 22 de outubro de 2026' } };
    assert.deepEqual(toCreateInput(draft, analysis, PEOPLE).brief, {
      sections: 1, size: 'standard', format: 'stand', formatSize: 'compact',
      event: { name: 'Seafood Show Latin America 2026', dates: 'De 20 a 22 de outubro de 2026' },
    });
    assert.equal(toCreateInput({ ...draft, event: EMPTY_EVENT }, analysis, PEOPLE).brief.event, undefined);
    assert.equal(toCreateInput({ ...sample }, analysis, PEOPLE).brief.format, undefined);
  });

  test('summary and blocker speak the format', () => {
    const note = { ...sample, ...withFormat('note') };
    assert.equal(briefSummary(note.size, note.sections, 2, note), 'Nota curta · 1 parte · 2 falantes');
    assert.equal(briefBlocker({ ...note, sections: 3 }), 'Nota curta aceita de 1 a 2 partes.');
    assert.equal(briefBlocker(note), undefined);
    assert.deepEqual(eventDraft({ name: 'APAS Show 2026' }), { ...EMPTY_EVENT, name: 'APAS Show 2026' });
  });
});

describe('Nova produção · a material sent in parts', () => {
  const srt = (text: string) => `1\n00:00:00,000 --> 00:00:05,000\nAna: ${text}\n`;
  const part = (id: string, text?: string, extra: Partial<MaterialPart> = {}): MaterialPart => ({ id, name: `${id}.srt`, size: 10, ...(text !== undefined ? { text } : {}), ...extra });
  const filed = (...parts: MaterialPart[]): NewProductionDraft => ({ ...EMPTY_DRAFT, mode: 'file', parts });

  test('draftMaterial waits for every part', () => {
    assert.deepEqual(draftMaterial(filed()), { text: '' });
    assert.deepEqual(draftMaterial(filed(part('a'))), { text: '', pending: true });
    assert.deepEqual(draftMaterial(filed(part('a', srt('um')))), { text: srt('um'), fileName: 'a.srt' });
    assert.deepEqual(draftMaterial(filed(part('a', srt('um')), part('b'))), { text: '', pending: true });
    const joined = draftMaterial(filed(part('a', srt('um')), part('b', srt('dois'))));
    assert.deepEqual(joined, { text: joinTranscriptParts([{ text: srt('um'), fileName: 'a.srt' }, { text: srt('dois'), fileName: 'b.srt' }]), fileName: 'a.srt' });
    assert.ok(joined.text.startsWith('\u001c\n'));
    assert.deepEqual(draftMaterial({ ...EMPTY_DRAFT, pasted: '\u001c\nAna: oi' }), { text: '\nAna: oi' });
    assert.deepEqual(draftMaterial({ ...EMPTY_DRAFT, mode: 'link', linkFile: { name: 'ep', size: 1, text: '\u001cAna: oi' } }), { text: 'Ana: oi', fileName: 'ep' });
    const long = 'x'.repeat(MAX_MATERIAL_CHARS / 2);
    assert.equal(materialTooLong(filed(part('a', long), part('b', long))), true);
    assert.equal(materialTooLong(filed(part('a', long + long))), false);
  });

  test('toCreateInput sends the parts and the first transcript', () => {
    const analysis = analysisOf(SAMPLE_TRANSCRIPT);
    const single = toCreateInput(filed(part('a', SAMPLE_TRANSCRIPT, { transcriptId: 't-a' })), analysis, PEOPLE).material;
    assert.equal(single.text, SAMPLE_TRANSCRIPT);
    assert.equal(single.transcriptId, 't-a');
    assert.equal(single.parts, undefined);
    const two = toCreateInput(filed(part('a', srt('um')), part('b', srt('dois'), { transcriptId: 't-b' })), analysis, PEOPLE).material;
    assert.equal(two.fileName, 'a.srt');
    assert.equal(two.transcriptId, 't-b');
    assert.deepEqual(two.parts, [{ fileName: 'a.srt' }, { fileName: 'b.srt', transcriptId: 't-b' }]);
    const drive = filed(part('a', srt('um'), { transcriptId: 't-a' }), part(RECEIVED_PART, srt('dois'), { transcriptId: 't-drive', received: true }));
    assert.equal(toCreateInput(drive, analysis, PEOPLE).material.transcriptId, 't-drive');
  });

  test('withMaterialText writes a corrected text back to every part', () => {
    assert.deepEqual(withMaterialText({ ...EMPTY_DRAFT, pasted: 'Ana: oi' }, 'Ana: olá'), { pasted: 'Ana: olá' });
    const link = { ...EMPTY_DRAFT, mode: 'link' as const, linkFile: { name: 'ep', size: 1, text: 'Ana: oi' } };
    assert.deepEqual(withMaterialText(link, 'Ana: olá'), { linkFile: { name: 'ep', size: 1, text: 'Ana: olá' } });
    assert.deepEqual(withMaterialText({ ...link, linkFile: null }, 'Ana: olá'), {});
    assert.deepEqual(withMaterialText(filed(part('a', 'Ana: oi')), 'Ana: olá'), { parts: [part('a', 'Ana: olá')] });
    // A .vtt part without its header and a cue part with one: only the header joining added goes away.
    const bare = 'Ana: oi\n\nBia: tchau';
    const headed = 'WEBVTT\n\n00:00.000 --> 00:05.000\nAna: oi';
    const draft = filed(part('a', bare, { name: 'a.vtt' }), part('b', headed, { name: 'b.vtt' }));
    const corrected = draftMaterial(draft).text.replaceAll('oi', 'olá');
    assert.deepEqual(withMaterialText(draft, corrected), { parts: [
      part('a', bare.replace('oi', 'olá'), { name: 'a.vtt' }),
      part('b', headed.replace('oi', 'olá'), { name: 'b.vtt' }),
    ] });
    assert.deepEqual(withMaterialText(draft, 'Ana: olá'), {});
    assert.deepEqual(withMaterialText(filed(part('a', bare), part('b', bare), part('c', bare)), corrected), {});
  });

  test('landPart, dropPart and movePart keep speaker choices until the last part goes', () => {
    const speakers = { Ana: { kind: 'none' as const } };
    const started = addParts({ ...filed(), speakers }, [part('a'), part('b')]);
    assert.deepEqual(started.speakers, {});
    assert.deepEqual(started.parts.map((each) => each.id), ['a', 'b']);
    const chosen = { ...started, speakers };
    const landed = landPart(chosen, 'b', { name: 'B.srt', size: 20, text: srt('dois'), transcriptId: 't-b' });
    assert.deepEqual(landed.parts[1], { id: 'b', name: 'B.srt', size: 20, text: srt('dois'), transcriptId: 't-b' });
    assert.equal(landed.speakers, speakers);
    assert.equal(landPart(landed, 'gone', { name: 'x', size: 1, text: 'x' }), landed);
    assert.equal(addParts(landed, [part('c')]).speakers, speakers);
    const moved = movePart(landed, 1, 0);
    assert.deepEqual(moved.parts.map((each) => each.id), ['b', 'a']);
    assert.equal(moved.speakers, speakers);
    assert.equal(movePart(landed, 0, 5), landed);
    const one = dropPart(moved, 'b');
    assert.deepEqual(one.parts.map((each) => each.id), ['a']);
    assert.equal(one.speakers, speakers);
    assert.equal(dropPart(one, 'gone'), one);
    assert.deepEqual(dropPart(one, 'a'), { ...one, parts: [], speakers: {} });
    const drive = landPart(filed(part(RECEIVED_PART, undefined, { received: true, name: 'Arquivo do Drive' })), RECEIVED_PART, { name: 'rec.mp3', size: 5, text: 'Ana: oi' });
    assert.deepEqual(drive.parts, [{ id: RECEIVED_PART, name: 'rec.mp3', size: 5, text: 'Ana: oi', received: true }]);
  });

  test('a draft with a part still uploading is dirty', () => {
    assert.equal(isDraftDirty(filed()), false);
    assert.equal(isDraftDirty(filed(part('a'))), true);
  });
});
