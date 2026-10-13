import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ARTICLE_SIZES, RUN_KIND_LABELS } from '../domain/index.ts';
import type { RunKind } from '../domain/index.ts';
import { GENERATION_KINDS, GENERATION_LABELS, RUN_KIND_OF } from '../ports/index.ts';
import { copilotPresets, copilotTool } from './copilot.ts';
import { ARTICLE_RUN_NEXT, recipeFor } from './recipes.ts';
import { draftSizeInstructions, HARD_NEWS_SIZING } from './sizing.ts';

/**
 * Generation as data (Track G): the outline-first recipe, the structure-only run "Montar
 * estrutura", the line that closes a draft's trace and the size contract a provider receives.
 */

describe('recipes · outline first', () => {
  test('"Montar estrutura" reads the material and proposes the structure, nothing else', () => {
    const recipe = recipeFor('article.outline');
    assert.equal(recipe.label, 'Montar estrutura');
    assert.deepEqual(recipe.steps().map((step) => [step.id, step.label]), [
      ['read', 'Lendo material'],
      ['outline', 'Montando estrutura'],
    ]);
    assert.equal(RUN_KIND_LABELS['article.outline'], 'Estrutura do artigo');
    assert.equal(GENERATION_LABELS['article.outline'], 'Montar estrutura');
    assert.equal(RUN_KIND_OF['article.outline'], 'article.outline');
  });

  test('every request maps onto a run kind with a recipe; ids are the draft\'s (structure first)', () => {
    for (const kind of GENERATION_KINDS) assert.ok(recipeFor(RUN_KIND_OF[kind]), kind);
    const draft = recipeFor('article.generate').steps({ sections: 2 }).map((step) => step.id);
    const outline = recipeFor('article.outline').steps().map((step) => step.id);
    assert.deepEqual(draft.slice(0, outline.length), outline, 'the outline run is the start of a draft');
  });

  test('a draft\'s trace closes with the next human step; other runs have none', () => {
    assert.equal(recipeFor('article.generate').next, ARTICLE_RUN_NEXT);
    assert.equal(ARTICLE_RUN_NEXT, 'Próximo: revisar o texto e enviar para aprovação');
    for (const kind of Object.keys(RUN_KIND_LABELS) as RunKind[]) {
      if (kind !== 'article.generate') assert.equal(recipeFor(kind).next, undefined, kind);
    }
  });

  test('step labels are newsroom words, sizes in laudas and characters (never words)', () => {
    for (const kind of Object.keys(RUN_KIND_LABELS) as RunKind[]) {
      for (const step of recipeFor(kind).steps({ sections: 3 })) assert.doesNotMatch(step.label, /palavra|Gerando|§|v\d/, `${kind}.${step.id}`);
    }
  });
});

describe('sizing · the provider contract', () => {
  test('budgets add up to the target and the sentence says never to pad', () => {
    for (const size of ['short', 'standard'] as const) {
      const spec = ARTICLE_SIZES[size];
      for (let sections = spec.sections.min; sections <= spec.sections.max; sections += 1) {
        const contract = draftSizeInstructions({ size, sections });
        assert.equal(contract.neverPad, true);
        assert.equal(contract.headings, spec.headings);
        assert.equal(contract.sections.length, sections);
        assert.deepEqual(contract.sections.map((section) => section.stepId), Array.from({ length: sections }, (_, index) => `section-${index + 1}`));
        const total = contract.introChars + contract.sections.reduce((sum, section) => sum + section.budgetChars, 0);
        assert.ok(total <= contract.targetChars && total > contract.targetChars - sections, `${size} ${sections}: ${total}`);
        assert.ok(contract.targetChars < contract.maxChars);
      }
    }
    assert.equal(draftSizeInstructions({ size: 'short', sections: 2 }).instruction, 'Escreva até 2.000 caracteres; se o material não sustentar, escreva menos e não complete.');
    assert.equal(HARD_NEWS_SIZING.neverPad, true);
  });
});

describe('copilot · size of the brief', () => {
  test('"Encurtar até o tamanho da pauta" shortens to the size, not to a word count', () => {
    const tool = copilotTool('shorten-to-brief');
    assert.ok(tool?.toBriefSize && tool.preset && tool.request === 'article.shorten');
    assert.equal(tool.label, 'Encurtar até o tamanho da pauta');
    assert.ok(copilotPresets('article').some((preset) => preset.id === 'shorten-to-brief'));
  });
});
