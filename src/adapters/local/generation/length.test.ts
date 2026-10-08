import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { blockText } from '../../../domain/article.ts';
import { expectedDraftWords, LENGTH_TARGETS, LENGTH_TOLERANCE } from '../../../domain/production.ts';
import type { ArticleLength } from '../../../domain/production.ts';
import { createTranscriptSource } from '../../../domain/source.ts';
import type { Source } from '../../../domain/source.ts';
import { parseTranscript } from '../../../domain/text/transcript-parse.ts';
import { createFixtures } from '../../../fixtures/index.ts';
import { SAMPLE_ANGLE, SAMPLE_TRANSCRIPT } from '../../../features/new-production/sample-material.ts';
import { extractivePlan, planBlocks, planWords } from './draft-plan.ts';
import { materialOutlook, wordsAvailable } from './outlook.ts';
import { createRng } from './random.ts';

/**
 * A09 (D10): the simulated article lands within ±10% of 500/800/1200 words when the material
 * allows; a shorter material gives everything it has (never invented text), and the Nova
 * produção preview says which. A07: raw speaker labels are never written as names.
 */

const NOW = '2026-10-07T12:00:00.000Z';
const fixtures = createFixtures({ now: NOW });
const sourceOf = (productionId: string): Source => {
  const record = fixtures.records.find((entry) => entry.production.id === productionId);
  assert.ok(record, productionId);
  return record.sources[0];
};
let counter = 0;
const newId = (prefix: string) => `${prefix}-${++counter}`;

function plan(source: Source, length: ArticleLength, sections = 3) {
  const result = extractivePlan({ sources: [source], brief: { sections, length, revision: 1 }, fallbackTitle: 'Matéria', rng: createRng(`len:${length}`), newId });
  assert.ok(result.ok);
  return result.value;
}

const within = (words: number, target: number) => Math.abs(words - target) <= target * LENGTH_TOLERANCE;

describe('length of the simulated article', () => {
  it('lands within ±10% of 500, 800 and 1200 words on a long material', () => {
    const source = sourceOf('prod-atelie-sul');
    for (const length of ['short', 'medium', 'long'] as const) {
      const words = planWords(plan(source, length));
      assert.ok(within(words, LENGTH_TARGETS[length].words), `${length}: ${words} words`);
    }
  });

  it('reaches a short article on a panel of ~500 words of answers', () => {
    const words = planWords(plan(sourceOf('prod-couro-nobre'), 'short'));
    assert.ok(within(words, 500), `${words} words`);
  });

  it('gives everything a short material has, and the preview says so before generating', () => {
    const source = sourceOf('prod-aurora');
    const outlook = materialOutlook(source.versions[0].content.segments);
    for (const length of ['short', 'medium', 'long'] as const) {
      const words = planWords(plan(source, length));
      const expected = expectedDraftWords(length, outlook.wordsAvailable);
      if (expected.reachesTarget) assert.ok(within(words, LENGTH_TARGETS[length].words), `${length}: ${words}`);
      else assert.ok(Math.abs(words - expected.words) <= expected.words * LENGTH_TOLERANCE, `${length}: preview ${expected.words}, draft ${words}`);
    }
    assert.equal(expectedDraftWords('medium', outlook.wordsAvailable).reachesTarget, false, 'this material cannot make 800 words');
  });

  it('tells a production already made how far its material goes (the brief\'s length hint)', () => {
    const source = sourceOf('prod-estudio-norte');
    const available = wordsAvailable([source]);
    assert.equal(available, materialOutlook(source.versions[0].content.segments).wordsAvailable);
    assert.equal(expectedDraftWords('medium', available).reachesTarget, false, 'a short interview cannot make 800 words');
    assert.equal(wordsAvailable([source]), available, 'remembered per material version');
  });

  it('keeps the preview of a long material at the target', () => {
    const source = sourceOf('prod-atelie-sul');
    const outlook = materialOutlook(source.versions[0].content.segments);
    assert.deepEqual(expectedDraftWords('long', outlook.wordsAvailable), { words: 1200, reachesTarget: true });
  });
});

describe('"Usar exemplo" of Nova produção', () => {
  const source = createTranscriptSource(
    { workspaceId: 'ws', title: 'Tendências do verão 2027', origin: 'interview', parsed: parseTranscript(SAMPLE_TRANSCRIPT), authorized: true },
    { now: NOW, actorId: 'person-ana', newId },
  );

  it('reaches Curta, Média and Longa within ±10%, whatever the seed (A09)', () => {
    for (const length of ['short', 'medium', 'long'] as const) {
      for (const seed of ['a', 'b', 'c']) {
        const result = extractivePlan({ sources: [source], brief: { sections: 3, length, angle: SAMPLE_ANGLE, revision: 1 }, fallbackTitle: 'Matéria', rng: createRng(seed), newId });
        assert.ok(result.ok);
        const words = planWords(result.value);
        assert.ok(within(words, LENGTH_TARGETS[length].words), `${length}/${seed}: ${words} words`);
      }
    }
    const outlook = materialOutlook(source.versions[0].content.segments, { angle: SAMPLE_ANGLE });
    assert.equal(expectedDraftWords('long', outlook.wordsAvailable).reachesTarget, true);
  });

  it('previews the headline the draft gets, for the same angle and names', () => {
    const names = { 'Lucas Ferraz': 'Lucas Ferraz', 'Beatriz Almeida': 'Beatriz Almeida' };
    const outlook = materialOutlook(source.versions[0].content.segments, { angle: SAMPLE_ANGLE, speakerNames: names });
    const speakers = { 'Lucas Ferraz': { name: 'Lucas Ferraz' }, 'Beatriz Almeida': { name: 'Beatriz Almeida' } };
    for (const seed of ['a', 'b']) {
      const result = extractivePlan({ sources: [source], brief: { sections: 3, length: 'medium', angle: SAMPLE_ANGLE, revision: 1 }, fallbackTitle: 'Matéria', speakers, rng: createRng(seed), newId });
      assert.ok(result.ok);
      assert.equal(result.value.title, outlook.headline, `seed ${seed}`);
    }
  });
});

describe('attribution of speakers without a person', () => {
  it('never writes a raw label as a name ("diz R.", "R..")', () => {
    const transcript = [
      'P.: O que mudou na fábrica neste ano?',
      'R.: Trocamos a linha de costura inteira. Foram seis meses de obra com a fábrica funcionando ao lado, o que exigiu muito planejamento. A produtividade subiu 20% e o retrabalho caiu pela metade, porque a máquina nova erra menos no ponto.',
      'P.: E a equipe?',
      'R.: A equipe foi treinada antes da troca. Cada costureira passou duas semanas aprendendo na máquina nova, ainda na linha antiga. Ninguém foi demitido. Pelo contrário, abrimos quatro vagas para a nova célula de acabamento, que antes era terceirizada.',
      'P.: Qual o próximo passo?',
      'R.: Automatizar o corte. Hoje o corte ainda é manual e é onde mais perdemos material. A meta é reduzir a sobra de couro em um terço até o fim do ano que vem.',
    ].join('\n');
    const source = createTranscriptSource({ workspaceId: 'ws', title: 'Entrevista', origin: 'interview', parsed: parseTranscript(transcript), authorized: true }, { now: NOW, actorId: 'person-ana', newId });
    const text = planBlocks(plan(source, 'short', 2)).map(blockText).join('\n');
    assert.doesNotMatch(text, /\bR\.\./);
    assert.doesNotMatch(text, /(diz|afirma|conta|explica|observa|completa) (R\.|P\.)/);
    assert.match(text, /“[^”]+”/, 'the answers are still quoted');
  });
});
