import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { analyzeTranscript, parseTranscript, sourceContentHash } from '../../domain/index.ts';
import type { SourceAnalysis } from '../../ports/index.ts';
import {
  EMPTY_DRAFT,
  generationBlocker,
  isDraftDirty,
  plannedStages,
  speakersWithoutPerson,
  suggestSpeaker,
  titleFromFileName,
  toCreateInput,
  validateDraft,
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

  test('speakers link to the one matching person, a new person, or wait for a decision', () => {
    assert.deepEqual(suggestSpeaker('Rafael Dias', PEOPLE), { kind: 'person', personId: 'person-rafael' });
    assert.deepEqual(suggestSpeaker('beatriz', PEOPLE), { kind: 'person', personId: 'person-beatriz' });
    assert.deepEqual(suggestSpeaker('Lucas Ferraz', PEOPLE), { kind: 'new', name: 'Lucas Ferraz' });
    assert.deepEqual(suggestSpeaker('Entrevistadora', PEOPLE), { kind: 'unset' });
    assert.deepEqual(suggestSpeaker('R.', PEOPLE), { kind: 'unset' });
  });

  test('"Gerar artigo" stays blocked until there is authorised material (registry check)', () => {
    assert.equal(generationBlocker(EMPTY_DRAFT, undefined), 'Adicione o material antes de gerar.');
    const analysis = analysisOf(SAMPLE_TRANSCRIPT);
    assert.equal(generationBlocker(sample, analysis), 'Confirme que o material está autorizado para gerar.');
    assert.equal(generationBlocker({ ...sample, authorized: true }, analysis), undefined);
  });

  test('validation lists material, new-person names and title in screen order', () => {
    assert.deepEqual(
      validateDraft(EMPTY_DRAFT, undefined, PEOPLE).map((issue) => issue.field),
      ['material', 'title'],
    );
    const analysis = analysisOf(SAMPLE_TRANSCRIPT);
    const unnamed = { ...sample, speakers: { [SAMPLE_NEW_SPEAKER]: { kind: 'new' as const, name: ' ' } } };
    assert.deepEqual(validateDraft(unnamed, analysis, PEOPLE).map((issue) => issue.field), [`speaker:${SAMPLE_NEW_SPEAKER}`]);
    assert.deepEqual(validateDraft(sample, analysis, PEOPLE), []);
  });

  test('"Gerar artigo" asks who every speaker is; "Sem atribuição" is a valid answer (A07)', () => {
    const transcript = 'Entrevistadora: Como começou?\nR.: Começou com uma máquina de costura na garagem e três clientes do bairro.';
    const analysis = analysisOf(transcript);
    const draft: NewProductionDraft = { ...EMPTY_DRAFT, pasted: transcript, title: 'Entrevista' };
    assert.deepEqual(speakersWithoutPerson(draft, analysis, PEOPLE), ['Entrevistadora', 'R.']);
    assert.equal(withoutPersonLabel(2), '2 falantes sem pessoa');
    assert.deepEqual(validateDraft(draft, analysis, PEOPLE, 'draft'), [], 'a draft can be saved before deciding');
    const issues = validateDraft(draft, analysis, PEOPLE, 'generate');
    assert.deepEqual(issues.map((issue) => [issue.field, issue.unattributed]), [['speaker:Entrevistadora', true], ['speaker:R.', true]]);
    const decided: NewProductionDraft = {
      ...draft,
      speakers: { Entrevistadora: { kind: 'none' }, 'R.': { kind: 'new', name: 'Rosa Antunes', title: 'fundadora', organization: 'Ateliê Rosa' } },
    };
    assert.deepEqual(validateDraft(decided, analysis, PEOPLE, 'generate'), []);
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
    assert.deepEqual(input.brief, { sections: 3, length: 'medium', angle: 'Foco no lojista' });
    assert.deepEqual(input.plan, ['article']);
  });

  test('the journey follows the plan', () => {
    assert.deepEqual(plannedStages('article-carousel').map((stage) => stage.label), ['Material', 'Artigo', 'Carrossel', 'Entrega']);
    assert.deepEqual(plannedStages('article').map((stage) => stage.label), ['Material', 'Artigo', 'Entrega']);
  });

  test('helpers: dirty flag and file-name titles', () => {
    assert.equal(isDraftDirty(EMPTY_DRAFT), false);
    assert.equal(isDraftDirty({ ...EMPTY_DRAFT, title: 'x' }), true);
    assert.equal(titleFromFileName('entrevista-atelie_sul.txt'), 'Entrevista atelie sul');
  });
});
