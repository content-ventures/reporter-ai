import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { articleStats, blockText, isImageSlot, paragraphBlock } from '../../../domain/article.ts';
import type { ArticleBlock } from '../../../domain/article.ts';
import { checkQuotes } from '../../../domain/quotes.ts';
import { resolveSourceRef } from '../../../domain/source.ts';
import { articleBodyFromRun } from '../../../domain/run-events.ts';
import { runToEnd } from '../../../ports/contracts/generation.contract.ts';
import { extractivePlan, planBlocks, planWords } from './draft-plan.ts';
import { DEFAULT_IMAGE_PLAN, visualMentions, withImageSlots } from './image-plan.ts';
import type { ImagePlanTarget } from './image-plan.ts';
import { lineRef, readMaterial, readSegments } from './material.ts';
import { createRng } from './random.ts';
import { ARTICLE_PIECE, createHarness, PRODUCTION_ID } from './testing.ts';

const DRAFT = { productionId: PRODUCTION_ID, pieceId: ARTICLE_PIECE };

describe('image plan · visual mentions', () => {
  it('cuts verbatim what a camera can show, with up to two complements and an adjective', () => {
    const texts = (text: string) => visualMentions(text).map((mention) => mention.text);
    assert.deepEqual(texts('Por uma loja de museu em Lisboa.'), ['loja de museu em Lisboa']);
    assert.deepEqual(texts('Hoje o Ateliê Sul é uma fábrica de calçados femininos de couro, com 142 pessoas.'), ['fábrica de calçados femininos de couro'], 'a brand is not a scene');
    assert.deepEqual(texts('Fábrica nova em Franca.'), ['Fábrica nova em Franca']);
    assert.deepEqual(texts('A gente desenha coleções para fábricas que não têm equipe.'), ['coleções', 'fábricas']);
    assert.deepEqual(texts('Adapta umas dez peças de cada coleção.'), ['peças', 'coleção']);
    assert.deepEqual(texts('Comprou duas máquinas de costurar.'), ['máquinas'], 'an infinitive starts a clause');
    assert.deepEqual(texts('Era a linha, sabe? Criamos uma linha de separação.'), ['linha de separação'], 'a vague noun needs a complement');
    assert.deepEqual(texts('O produto da Bella Passo chegou.'), ['produto da Bella Passo'], 'a proper name stays whole');
    assert.deepEqual(texts('Ninguém falou disso.'), []);
  });

  it('scores specific mentions above bare nouns', () => {
    const [named] = visualMentions('Por uma loja de museu em Lisboa.');
    const [bare] = visualMentions('Visitamos lojas.');
    assert.ok(named.score > bare.score);
  });
});

const MATERIAL = readSegments([
  { id: 'seg-1', speaker: 'Entrevistadora', text: 'Como começou a padaria?' },
  { id: 'seg-2', speaker: 'Lúcia', text: 'Começou na cozinha da minha mãe, com um forno elétrico pequeno e muita vontade de fazer pão.' },
  { id: 'seg-3', speaker: 'Entrevistadora', text: 'E a cooperativa?' },
  { id: 'seg-4', speaker: 'Rafael Nunes', text: 'Eu cuidei das contas da cooperativa desde o começo, sem cobrar nada de ninguém.' },
  { id: 'seg-5', speaker: 'Entrevistadora', text: 'E os planos?' },
  { id: 'seg-6', speaker: 'Lúcia', text: 'Queremos abrir uma escola de panificação para jovens do bairro, aos sábados.' },
]);

function ref(segmentId: string) {
  const line = MATERIAL.lines.find((entry) => entry.segmentId === segmentId);
  assert.ok(line);
  return lineRef(line);
}

function plan(): ImagePlanTarget {
  const p = (id: string, segment: string) => paragraphBlock(id, MATERIAL.lines.find((line) => line.segmentId === segment)?.text ?? '', { ai: 'unreviewed', sourceRefs: [ref(segment)] });
  return {
    intro: [p('i1', 'seg-2')],
    sections: [{ blocks: [p('a1', 'seg-4')] }, { blocks: [p('b1', 'seg-6'), p('b2', 'seg-4')] }, { blocks: [p('c1', 'seg-4')] }, { blocks: [p('d1', 'seg-4')] }],
  };
}

let counter = 0;
const newId = (prefix: string) => `${prefix}-img-${(counter += 1)}`;
const speakers = { Lúcia: { name: 'Lúcia Prado', title: 'fundadora da padaria' } };

describe('image plan · slots', () => {
  it('after the introduction, inside every second section (after its opening) and a cover suggestion', () => {
    const planned = withImageSlots(plan(), { material: MATERIAL, speakers, newId });
    assert.deepEqual(DEFAULT_IMAGE_PLAN, { afterIntro: true, everySections: 2, cover: true });
    assert.deepEqual(planned.coverSlot, {
      subject: 'Retrato de Lúcia Prado',
      suggestedCaption: 'Lúcia Prado, fundadora da padaria',
      suggestedAlt: 'Retrato de Lúcia Prado',
      orientation: 'landscape',
    });
    const introSlot = planned.intro[1];
    assert.ok(introSlot && isImageSlot(introSlot));
    assert.equal(introSlot.slot.subject, 'Forno elétrico', 'the most specific scene of the opening, verbatim');
    assert.deepEqual(introSlot.sourceRefs, [ref('seg-2')]);
    assert.deepEqual(planned.sections.map((section) => section.blocks.map((block) => (isImageSlot(block) ? `slot:${block.slot.subject}` : block.id))), [
      ['a1'],
      ['b1', 'slot:Escola de panificação', 'b2'],
      ['c1'],
      ['d1', 'slot:Retrato de Rafael Nunes'],
    ]);
  });

  it('is configurable and never invents: no mention and no named voice, no slot', () => {
    const none = withImageSlots(plan(), { material: MATERIAL, speakers, newId, options: { afterIntro: false, everySections: 0, cover: false } });
    assert.equal(none.coverSlot, undefined);
    assert.ok([...none.intro, ...none.sections.flatMap((section) => section.blocks)].every((block) => !isImageSlot(block)));
    const everyOne = withImageSlots(plan(), { material: MATERIAL, speakers, newId, options: { everySections: 1 } });
    assert.equal(everyOne.sections.filter((section) => section.blocks.some(isImageSlot)).length, 2, 'only where the material holds something to show');
    const anonymous = readSegments([
      { id: 'seg-1', speaker: 'P1', text: 'Foi um ano difícil para todo mundo que trabalha com isso.' },
      { id: 'seg-2', speaker: 'P1', text: 'A gente aprendeu a esperar e a pensar melhor antes de decidir qualquer coisa.' },
    ]);
    const bare: ImagePlanTarget = {
      intro: [paragraphBlock('i1', 'Foi um ano difícil para todo mundo que trabalha com isso.')],
      sections: [{ blocks: [paragraphBlock('a1', 'Texto.')] }, { blocks: [paragraphBlock('b1', 'Outro texto.')] }],
    };
    const empty = withImageSlots(bare, { material: anonymous, newId });
    assert.equal(empty.coverSlot, undefined, 'a raw label is never a portrait');
    assert.equal(empty.intro.length, 1);
    assert.ok(empty.sections.every((section) => !section.blocks.some(isImageSlot)));
  });
});

describe('image plan · extractive draft', () => {
  it('adds slots without touching the text: same words, same quotes, grounded evidence', () => {
    const harness = createHarness();
    const sources = harness.record().sources;
    const input = {
      sources,
      brief: harness.record().production.brief,
      fallbackTitle: 'Padaria',
      rng: createRng('seed'),
      newId: (prefix: string) => `${prefix}-${(counter += 1)}`,
    };
    const withSlots = extractivePlan(input);
    const textOnly = extractivePlan({ ...input, rng: createRng('seed'), images: false });
    assert.ok(withSlots.ok && textOnly.ok);
    const blocks = planBlocks(withSlots.value);
    const slots = blocks.filter(isImageSlot);
    assert.ok(slots.length >= 1, 'the draft asks for images');
    assert.equal(planWords(withSlots.value), planWords(textOnly.value));
    assert.deepEqual(blocks.filter((block) => !isImageSlot(block)).map(blockText), planBlocks(textOnly.value).map(blockText));
    for (const slot of slots) {
      assert.equal(slot.ai, undefined);
      for (const evidence of slot.sourceRefs ?? []) assert.ok(resolveSourceRef(sources, evidence), 'evidence resolves');
    }
    const text = (list: readonly ArticleBlock[]) => ({ type: 'article' as const, title: '', blocks: [...list] });
    const statuses = (list: readonly ArticleBlock[]) => checkQuotes(text(list), sources).map((check) => check.status);
    assert.deepEqual(statuses(blocks), statuses(planBlocks(textOnly.value)));
    assert.equal(articleStats(text(blocks)).words, articleStats(text(planBlocks(textOnly.value))).words);
    assert.ok(readMaterial(sources).speakers.length > 0);
  });

  it('streams the cover suggestion with the outline and each slot whole; the output keeps them', async () => {
    const harness = createHarness();
    const run = await runToEnd(harness.service, 'article.draft', DRAFT);
    const outline = run.events.find((event) => event.type === 'outline');
    assert.ok(outline?.type === 'outline' && outline.cover?.subject, 'the outline suggests a cover');
    const body = articleBodyFromRun(run.fold);
    const slots = body.blocks.filter(isImageSlot);
    assert.ok(slots.length >= 1);
    for (const slot of slots) {
      assert.ok(!run.events.some((event) => event.type === 'block.started' && event.block.id === slot.id), 'a slot is never "being written"');
      assert.ok(run.events.some((event) => event.type === 'block.completed' && event.block.id === slot.id));
    }
    assert.deepEqual(body.coverSlot, outline.cover);
    const piece = harness.record().pieces.find((entry) => entry.id === ARTICLE_PIECE);
    assert.ok(piece?.draft.body.type === 'article' && piece.draft.body.coverSlot?.subject === outline.cover?.subject, 'the draft keeps the suggestion');
  });

  it('a simulated failure still stops inside the section text, never on a slot', async () => {
    const harness = createHarness();
    const failed = await runToEnd(harness.service, 'article.draft', DRAFT, { simulation: 'fail-section' });
    assert.equal(failed.fold.run.error?.stepId, 'section-2');
    const partial = failed.fold.blocks.filter((block) => !block.complete);
    assert.ok(partial.every((block) => block.type !== 'figure'));
  });
});
