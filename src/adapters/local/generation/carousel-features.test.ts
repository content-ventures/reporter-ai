import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { headingBlock, listBlock, paragraphBlock } from '../../../domain/article.ts';
import type { ArticleBody } from '../../../domain/article.ts';
import type { Slide } from '../../../domain/carousel.ts';
import { CAROUSEL_TEMPLATES, CAROUSEL_TEMPLATE_RENDERS } from '../../../fixtures/templates/catalog.ts';
import { createLocalRenderService } from '../render/local-render.ts';
import type { SlideCopy } from '../../../ports/script-book.ts';
import { featureSlides, findEnumeration, findFigure } from './carousel-features.ts';
import { extractiveCarouselPlan, planFromCarouselScript } from './carousel-plan.ts';
import { fitSlide, swapPoint } from './slide-assist.ts';

/**
 * Featured layouts: "Números" turns a point with a figure into a data slide, "Passo a passo" a
 * point with a list or an enumeration into a list slide — from the article's own words only.
 */

const template = (id: string) => {
  const found = CAROUSEL_TEMPLATES.find((entry) => entry.id === id);
  assert.ok(found, id);
  return found;
};
const NUMEROS = template('tpl-numeros');
const PASSOS = template('tpl-passo-a-passo');
const EDITORIAL = CAROUSEL_TEMPLATES[0];

const ARTICLE: ArticleBody = {
  type: 'article',
  title: 'A cooperativa que levou o café do sítio à xícara',
  blocks: [
    paragraphBlock('intro', 'Em 2018, nove produtoras dividiam um secador. Hoje são 64 famílias e torra própria.'),
    headingBlock('h1', 'Qualidade medida', 2),
    paragraphBlock('p1', '41% mais renda chegou às famílias em três safras. A venda direta fez a diferença.'),
    headingBlock('h2', 'O método', 2),
    paragraphBlock('p2', 'A cooperativa mudou em três frentes: torra o próprio grão, prova cada lote antes da venda e fecha contrato direto com cafeterias.'),
    headingBlock('h3', 'Próximos passos', 2),
    paragraphBlock('p3', 'Agora a cooperativa ensina o método a outras 12 associações da região.'),
  ],
};

let counter = 0;
const newId = (prefix: string) => `${prefix}-${(counter += 1)}`;

describe('figures and enumerations', () => {
  it('finds the most telling figure, never a year, and the text that follows it', () => {
    assert.deepEqual(findFigure('Em 2015, duas máquinas. Hoje, 38% do faturamento vem de fora.', 7), {
      stat: '38%',
      sentence: 'Hoje, 38% do faturamento vem de fora.',
      body: 'Hoje, 38% do faturamento vem de fora.',
      score: 3,
    });
    assert.equal(findFigure('70% do couro já é rastreado. Sem origem, fica fora.', 7)?.body, 'do couro já é rastreado.');
    assert.equal(findFigure('São 1.100 pares por dia.', 7)?.stat, '1.100');
    assert.equal(findFigure('A empresa nasceu em 2015 com 2 sócios.', 7), undefined);
    assert.equal(findFigure('Faturou R$ 2,5 milhões no ano.', 7), undefined, 'longer than the slot');
  });

  it('reads "…: a, b e c" as a list of three items or more', () => {
    assert.deepEqual(findEnumeration('A cooperativa mudou em três frentes: torra o próprio grão, prova cada lote e fecha contrato direto.'), {
      head: 'A cooperativa mudou em três frentes',
      items: ['Torra o próprio grão', 'Prova cada lote', 'Fecha contrato direto'],
    });
    assert.equal(findEnumeration('Disse: sim e não.'), undefined);
  });
});

describe('featured layouts in the carousel plan', () => {
  it('Números: the first point with a figure becomes a data slide; other templates keep the point', () => {
    const plan = extractiveCarouselPlan({ article: ARTICLE, template: NUMEROS, slides: 5, sources: [], newId });
    const data = plan.slides.find((slide) => slide.layout === 'data');
    assert.ok(data, plan.slides.map((slide) => slide.layout).join(' · '));
    assert.equal(data.slots.stat, '41%');
    assert.equal(data.slots.body, 'mais renda chegou às famílias em três safras.');
    assert.equal(data.slots.title, 'Qualidade medida');
    const plain = extractiveCarouselPlan({ article: ARTICLE, template: EDITORIAL, slides: 5, sources: [], newId });
    assert.ok(!plain.slides.some((slide) => slide.layout === 'data' || slide.layout === 'list'));
  });

  it('Passo a passo: an enumeration of the article becomes a list slide with its section title', () => {
    const plan = extractiveCarouselPlan({ article: ARTICLE, template: PASSOS, slides: 6, sources: [], newId });
    const list = plan.slides.find((slide) => slide.layout === 'list');
    assert.ok(list, plan.slides.map((slide) => slide.layout).join(' · '));
    assert.equal(list.slots.items, 'Torra o próprio grão\nProva cada lote antes da venda\nFecha contrato direto com cafeterias');
    assert.deepEqual(list.sourceBlockIds.at(-1), 'p2');
  });

  it('prefers an article list, and leaves the plan alone without material', () => {
    const withList: ArticleBody = { ...ARTICLE, blocks: [...ARTICLE.blocks, listBlock('l1', ['Torra própria', 'Prova de cada lote', 'Contrato direto'])] };
    const slides: Slide[] = [{ id: 's', layout: 'point', slots: { title: 'O método' }, sourceBlockIds: ['l1'] }];
    assert.equal(featureSlides(slides, PASSOS, withList)[0].slots.items, 'Torra própria\nProva de cada lote\nContrato direto');
    const bare: ArticleBody = { type: 'article', title: 'Sem números', blocks: [paragraphBlock('x', 'Um texto sem figura nem lista.')] };
    const point: Slide[] = [{ id: 's', layout: 'point', slots: { title: 'Ponto', body: 'Um texto sem figura nem lista.' }, sourceBlockIds: ['x'] }];
    assert.deepEqual(featureSlides(point, NUMEROS, bare), point);
    assert.deepEqual(featureSlides(point, PASSOS, bare), point);
  });

  it('hand-written copy gets the featured layouts too, and the result fits the model', () => {
    const copy: SlideCopy[] = [
      { layout: 'cover', slots: { kicker: 'Entrevista', title: 'A cooperativa do café' }, sourceBlockIds: ['intro'] },
      { layout: 'context', slots: { body: 'Em 2018, nove produtoras dividiam um secador.' }, sourceBlockIds: ['intro'] },
      { layout: 'point', slots: { title: 'Qualidade medida', body: '41% mais renda chegou às famílias em três safras.' }, sourceBlockIds: ['h1', 'p1'] },
      { layout: 'quote', slots: { quote: 'O preço deixa de ser segredo.' }, sourceBlockIds: ['p3'] },
      { layout: 'closing', slots: { title: 'Do sítio à xícara' }, sourceBlockIds: ['p3'] },
    ];
    const plan = planFromCarouselScript(copy, { article: ARTICLE, template: NUMEROS, slides: 5, newId });
    assert.ok(plan);
    assert.deepEqual(
      plan.slides.map((slide) => slide.layout),
      ['cover', 'context', 'data', 'quote', 'closing'],
    );
    const render = createLocalRenderService({ templates: CAROUSEL_TEMPLATES, renders: CAROUSEL_TEMPLATE_RENDERS, createSurface: () => undefined });
    const measured = render.measure({ type: 'carousel', templateId: NUMEROS.id, slides: plan.slides });
    assert.ok(measured.ok && measured.value.every((fit) => !fit.overflow));
  });
});

describe('slide assist on featured layouts', () => {
  it('"Trocar ponto" on a data slide moves to the next figure, with its text and title', () => {
    const slide: Slide = { id: 'd', layout: 'data', slots: { title: 'Qualidade medida', stat: '41%', body: 'mais renda chegou às famílias.' }, sourceBlockIds: ['h1', 'p1'] };
    const swapped = swapPoint({ slide, template: NUMEROS, article: ARTICLE, slides: [slide] });
    assert.ok(swapped.ok);
    assert.deepEqual(swapped.proposal.slots, { stat: '12', body: 'Agora a cooperativa ensina o método a outras 12 associações da região.', title: 'Próximos passos' });
    assert.deepEqual(swapped.proposal.sourceBlockIds, ['h3', 'p3']);
  });

  it('"Encurtar para caber" drops list items, never cuts inside one', () => {
    const items = ['Torra o próprio grão', 'Prova cada lote antes da venda', 'Fecha contrato direto com cafeterias', 'Ensina outras associações'].join('\n');
    const slide: Slide = { id: 'l', layout: 'list', slots: { title: 'O método', items }, sourceBlockIds: [] };
    const fitted = fitSlide({ slide, template: PASSOS }, new Set(['items']), (_, text) => text.split('\n').length <= 3);
    assert.ok(fitted.ok);
    assert.equal(fitted.proposal.slots.items, items.split('\n').slice(0, 3).join('\n'));
  });
});
