import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { analyzeTranscript, parseTranscript, sourceContentHash } from '../../domain/index.ts';
import type { SourceAnalysis } from '../../ports/index.ts';
import {
  EMPTY_DRAFT,
  NEW_PRODUCTION_STEPS,
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
import type { NewProductionDraft } from './form.ts';
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

  test('three steps: Material, Pauta, Estrutura', () => {
    assert.deepEqual(NEW_PRODUCTION_STEPS.map((step) => STEP_LABELS[step]), ['Material', 'Pauta', 'Estrutura']);
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
    assert.equal(materialBlocker(sample), 'Marque a autorização dos falantes para continuar.');
    assert.equal(materialBlocker({ ...sample, authorized: true }), undefined);
  });

  test('"Montar estrutura" needs an internal title and a section count the size accepts', () => {
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
    assert.match(shortfallSentence('standard', 800) ?? '', /^O material rende ≈ .* lauda\. O texto sai com isso\.$/);
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

  test('helpers: dirty flag', () => {
    assert.equal(isDraftDirty(EMPTY_DRAFT), false);
    assert.equal(isDraftDirty({ ...EMPTY_DRAFT, title: 'x' }), true);
    assert.equal(isDraftDirty({ ...EMPTY_DRAFT, size: 'short' }), true);
  });
});
