import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { blockText } from '../../../domain/article.ts';
import { personLine } from '../../../domain/workspace.ts';
import { ARTICLE_SIZES, expectedDraftChars, SIZE_TOLERANCE } from '../../../domain/sizing.ts';
import type { ArticleSize } from '../../../domain/sizing.ts';
import { createTranscriptSource } from '../../../domain/source.ts';
import type { Source } from '../../../domain/source.ts';
import { parseTranscript } from '../../../domain/text/transcript-parse.ts';
import { createFixtures } from '../../../fixtures/index.ts';
import { SAMPLE_ANGLE, SAMPLE_TRANSCRIPT } from '../../../features/new-production/sample-material.ts';
import { extractivePlan, extractivePlanFromOutline, longestPlanChars, planBlocks, planChars } from './draft-plan.ts';
import type { DraftPlan, ExtractiveInput, PlannedOutline } from './draft-plan.ts';
import { measureDraft, paddingIn } from './draft-audit.ts';
import { readMaterial } from './material.ts';
import { normalizeOutline, outlineEvent } from './outline.ts';
import { charsAvailable, materialOutlook } from './outlook.ts';
import { createRng } from './random.ts';
import { INTERVIEW } from './testing.ts';

/**
 * The lauda rule (João, 2026-10-08): the simulated article aims at the size's target (Curto
 * 1.800, Padrão 3.600 characters, ±10%) and never goes above its maximum (2.000, 4.000); a
 * shorter material gives everything it has (never padded), and the preview says so before
 * generating. A07: raw speaker labels are never written as names.
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
const SIZES: readonly ArticleSize[] = ['short', 'standard'];

function plan(source: Source, size: ArticleSize, sections = ARTICLE_SIZES[size].sections.default) {
  const result = extractivePlan({ sources: [source], brief: { sections, size, revision: 1 }, fallbackTitle: 'Matéria', rng: createRng(`len:${size}`), newId });
  assert.ok(result.ok);
  return result.value;
}

const onTarget = (chars: number, size: ArticleSize) => Math.abs(chars - ARTICLE_SIZES[size].targetChars) <= ARTICLE_SIZES[size].targetChars * SIZE_TOLERANCE;

describe('size of the simulated article', () => {
  it('lands within ±10% of 1.800 and 3.600 characters on a long material, never above 2.000 and 4.000', () => {
    const source = sourceOf('prod-atelie-sul');
    for (const size of SIZES) {
      const chars = planChars(plan(source, size));
      assert.ok(onTarget(chars, size), `${size}: ${chars} characters`);
      assert.ok(chars <= ARTICLE_SIZES[size].maxChars, `${size}: ${chars} above the maximum`);
    }
  });

  it('reaches a Curto on a panel of ~500 words of answers', () => {
    const chars = planChars(plan(sourceOf('prod-couro-nobre'), 'short'));
    assert.ok(onTarget(chars, 'short'), `${chars} characters`);
  });

  it('gives everything a short material has, and the preview says so before generating', () => {
    const source = sourceOf('prod-aurora');
    const outlook = materialOutlook(source.versions[0].content.segments);
    for (const size of SIZES) {
      const chars = planChars(plan(source, size));
      const expected = expectedDraftChars(size, outlook.charsAvailable);
      assert.ok(chars <= ARTICLE_SIZES[size].maxChars, `${size}: ${chars} above the maximum`);
      if (expected.reachesTarget) assert.ok(onTarget(chars, size), `${size}: ${chars}`);
      else assert.ok(Math.abs(chars - expected.chars) <= expected.chars * SIZE_TOLERANCE, `${size}: preview ${expected.chars}, draft ${chars}`);
    }
    const padrao = expectedDraftChars('standard', outlook.charsAvailable);
    assert.equal(padrao.reachesTarget, false, 'this material cannot make 3.600 characters');
    assert.equal(padrao.reachesRange, true, 'but it still fills 2 laudas');
  });

  it('tells a production already made how far its material goes (the brief\'s size hint)', () => {
    const source = sourceOf('prod-estudio-norte');
    const available = charsAvailable([source]);
    assert.equal(available, materialOutlook(source.versions[0].content.segments).charsAvailable);
    assert.equal(expectedDraftChars('standard', available).reachesTarget, false, 'a short interview cannot make 3.600 characters');
    assert.equal(charsAvailable([source]), available, 'remembered per material version');
  });

  it('keeps the preview of a long material at the target', () => {
    const source = sourceOf('prod-atelie-sul');
    const outlook = materialOutlook(source.versions[0].content.segments);
    assert.deepEqual(expectedDraftChars('standard', outlook.charsAvailable), { chars: 3600, reachesTarget: true, reachesRange: true });
  });
});

describe('"Usar exemplo" of Nova produção', () => {
  const source = createTranscriptSource(
    { workspaceId: 'ws', title: 'Tendências do verão 2027', origin: 'interview', parsed: parseTranscript(SAMPLE_TRANSCRIPT), authorized: true },
    { now: NOW, actorId: 'person-ana', newId },
  );

  it('reaches Curto and Padrão within ±10%, never above the maximum, whatever the seed (A09)', () => {
    for (const size of SIZES) {
      for (const seed of ['a', 'b', 'c']) {
        const sections = ARTICLE_SIZES[size].sections.default;
        const result = extractivePlan({ sources: [source], brief: { sections, size, angle: SAMPLE_ANGLE, revision: 1 }, fallbackTitle: 'Matéria', rng: createRng(seed), newId });
        assert.ok(result.ok);
        const chars = planChars(result.value);
        assert.ok(onTarget(chars, size), `${size}/${seed}: ${chars} characters`);
        assert.ok(chars <= ARTICLE_SIZES[size].maxChars, `${size}/${seed}: ${chars} above the maximum`);
      }
    }
    const outlook = materialOutlook(source.versions[0].content.segments, { angle: SAMPLE_ANGLE });
    assert.equal(expectedDraftChars('standard', outlook.charsAvailable).reachesTarget, true);
  });

  it('previews the headline the draft gets, for the same angle and names', () => {
    const names = { 'Lucas Ferraz': 'Lucas Ferraz', 'Beatriz Almeida': 'Beatriz Almeida' };
    const outlook = materialOutlook(source.versions[0].content.segments, { angle: SAMPLE_ANGLE, speakerNames: names });
    const speakers = { 'Lucas Ferraz': { name: 'Lucas Ferraz' }, 'Beatriz Almeida': { name: 'Beatriz Almeida' } };
    for (const seed of ['a', 'b']) {
      const result = extractivePlan({ sources: [source], brief: { sections: 3, size: 'standard', angle: SAMPLE_ANGLE, revision: 1 }, fallbackTitle: 'Matéria', speakers, rng: createRng(seed), newId });
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
    const text = planBlocks(plan(source, 'standard', 2)).map(blockText).join('\n');
    assert.doesNotMatch(text, /\bR\.\./);
    assert.doesNotMatch(text, /(diz|afirma|conta|explica|observa|completa) (R\.|P\.)/);
    assert.match(text, /“[^”]+”/, 'the answers are still quoted');
  });
});

/**
 * The measured matrix (Track G): every fixture material, "Usar exemplo" and the test interview,
 * × Curto and Padrão × every section count the size allows, through the default draft, the round
 * trip "Montar estrutura" → "Redigir artigo" as proposed, and an edited structure (reversed, one
 * section removed when the size allows). Never above the maximum; on the target ±10% or an honest
 * shortfall; never padded; a Curto without intertítulos; no heading is a question.
 */
describe('the size rule across every material, size and section count', () => {
  type Material = { name: string; sources: Source[]; angle?: string; speakers?: Record<string, { name: string; title?: string }> };
  const materials: Material[] = fixtures.records.map((record) => {
    const speakers: Record<string, { name: string; title?: string }> = {};
    for (const source of record.sources) {
      for (const speaker of source.speakers) {
        const person = fixtures.people.find((entry) => entry.id === speaker.personId);
        const title = person ? personLine(person) : undefined;
        if (person) speakers[speaker.label] = title ? { name: person.name, title } : { name: person.name };
      }
    }
    const material: Material = { name: record.production.id, sources: record.sources, speakers };
    if (record.production.brief.angle) material.angle = record.production.brief.angle;
    return material;
  });
  const transcript = (text: string) => createTranscriptSource({ workspaceId: 'ws', title: 'Entrevista', origin: 'interview', parsed: parseTranscript(text), authorized: true }, { now: NOW, actorId: 'person-ana', newId });
  materials.push({ name: 'Usar exemplo', sources: [transcript(SAMPLE_TRANSCRIPT)], angle: SAMPLE_ANGLE });
  materials.push({ name: 'entrevista de teste', sources: [transcript(INTERVIEW)] });

  const structureOf = (plan: DraftPlan): PlannedOutline => ({
    title: plan.title,
    intro: plan.introQuotes,
    sections: plan.sections.map((section) => ({ blockId: section.blockId, title: section.title, quotes: section.quotes })),
  });

  for (const material of materials) {
    it(`${material.name}: never above the size, never padded`, () => {
      const lines = readMaterial(material.sources);
      for (const size of SIZES) {
        const spec = ARTICLE_SIZES[size];
        for (let sections = spec.sections.min; sections <= spec.sections.max; sections += 1) {
          const input: ExtractiveInput = {
            sources: material.sources,
            brief: { sections, size, revision: 1, ...(material.angle ? { angle: material.angle } : {}) },
            fallbackTitle: 'Matéria',
            rng: createRng(`matrix:${material.name}:${size}:${sections}`),
            newId,
            ...(material.speakers ? { speakers: material.speakers } : {}),
          };
          const result = extractivePlan(input);
          assert.ok(result.ok, `${material.name} ${size} ${sections}`);
          const plan = result.value;
          const announced = outlineEvent(plan, { size, materialChars: charsAvailable(material.sources) });
          const structure = structureOf(plan);
          // The proposal passes the checks "Redigir artigo" runs (one place per quote, sizes, titles).
          const checked = normalizeOutline({ title: structure.title, intro: { quotes: structure.intro }, sections: structure.sections }, { size, material: lines, defaultTitle: () => 'x' });
          assert.ok(checked.ok, `${material.name} ${size} ${sections}: ${checked.ok ? '' : checked.refusal.message}`);
          assert.deepEqual(checked.value, structure);
          const edited = [...structure.sections].reverse();
          if (edited.length > spec.sections.min) edited.splice(1, 1);
          const round = extractivePlanFromOutline(input, structure);
          const reviewed = extractivePlanFromOutline(input, { ...structure, sections: edited });
          assert.ok(round.ok && reviewed.ok);
          const cases: [string, DraftPlan][] = [['material', plan], ['estrutura', round.value], ['editada', reviewed.value]];
          for (const [path, candidate] of cases) {
            const where = `${material.name} · ${spec.label} · ${sections} · ${path}`;
            const body = { type: 'article' as const, title: candidate.title, blocks: planBlocks(candidate) };
            const measured = measureDraft(body);
            assert.ok(measured.chars <= spec.maxChars, `${where}: ${measured.chars} caracteres passam de ${spec.maxChars}`);
            assert.deepEqual(paddingIn(body, material.sources), [], where);
            assert.equal(measured.headings, spec.headings ? candidate.sections.length : 0, `${where}: intertítulos`);
            assert.equal(measured.questionHeadings, 0, `${where}: a heading is never the interviewer's question`);
          }
          // The material's own draft lands on the target, or the outline says the material gives less.
          const chars = planChars(plan);
          if (announced.shortfall) {
            assert.equal(announced.shortfall.expectedChars, chars);
            assert.ok(chars < spec.targetChars * (1 - SIZE_TOLERANCE));
            // Everything the material holds for this structure, never less than most of it.
            const longest = Math.min(spec.maxChars, longestPlanChars(lines, sections));
            assert.ok(chars >= longest * 0.8, `${material.name} ${size} ${sections}: ${chars} of the ${longest} it gives`);
          } else {
            assert.ok(onTarget(chars, size), `${material.name} ${size} ${sections}: ${chars}`);
          }
          // The structure as proposed writes the same sections, near the same size.
          assert.deepEqual(round.value.sections.map((section) => section.title), plan.sections.map((section) => section.title));
          assert.ok(Math.abs(planChars(round.value) - chars) <= spec.targetChars * SIZE_TOLERANCE, `${material.name} ${size} ${sections}: round trip ${planChars(round.value)} vs ${chars}`);
        }
      }
    });
  }
});
