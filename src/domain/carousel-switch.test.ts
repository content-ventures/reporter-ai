import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CarouselBody, CarouselTemplate, SlideLayout, SlotSpec } from './carousel.ts';
import { changeSlideLayout, switchTemplate, targetLayout } from './carousel-switch.ts';

/**
 * Switching a carousel's template (or a slide's layout) keeps the person's texts: by slot id,
 * then by role, then joined to the closest slot; what has no place is reported with its text.
 */

const slot = (id: string, label: string, role: SlotSpec['role'], maxChars: number, required = false): SlotSpec => ({ id, label, role, maxChars, ...(required ? { required: true } : {}) });

const LIBRARY: SlideLayout[] = [
  { id: 'cover', label: 'Capa', slots: [slot('kicker', 'Chamada', 'kicker', 32), slot('title', 'Título', 'title', 70, true)] },
  { id: 'point', label: 'Ponto principal', slots: [slot('title', 'Título', 'title', 40, true), slot('body', 'Texto', 'body', 200)] },
  { id: 'data', label: 'Número', slots: [slot('title', 'Título', 'title', 40), slot('stat', 'Número', 'stat', 7, true), slot('body', 'Texto', 'body', 140, true)] },
  { id: 'list', label: 'Lista', slots: [slot('title', 'Título', 'title', 50), slot('items', 'Itens', 'list', 180, true)] },
  { id: 'quote', label: 'Citação', slots: [slot('quote', 'Citação', 'quote', 140, true), slot('attribution', 'Crédito', 'attribution', 60)] },
  { id: 'closing', label: 'Conclusão', slots: [slot('title', 'Título', 'title', 50, true), slot('body', 'Texto', 'body', 160), slot('cta', 'Chamada final', 'cta', 32)] },
];

const FULL: CarouselTemplate = { id: 'tpl-full', name: 'Completo', width: 1080, height: 1350, minSlides: 3, maxSlides: 10, coverLayoutId: 'cover', layouts: LIBRARY };

/** A Marketing model with fewer layouts, its own cover id and a cover without a call. */
const NARROW: CarouselTemplate = {
  id: 'tpl-narrow',
  name: 'Estreito',
  width: 1080,
  height: 1080,
  minSlides: 3,
  maxSlides: 4,
  coverLayoutId: 'abertura',
  layouts: [
    { id: 'abertura', label: 'Abertura', slots: [slot('headline', 'Manchete', 'title', 40, true)] },
    { id: 'point', label: 'Ponto', slots: [slot('title', 'Título', 'title', 40, true), slot('body', 'Texto', 'body', 120)] },
    { id: 'closing', label: 'Fim', slots: [slot('title', 'Título', 'title', 50, true), slot('body', 'Texto', 'body', 160)] },
  ],
};

const BODY: CarouselBody = {
  type: 'carousel',
  templateId: FULL.id,
  slides: [
    { id: 's1', layout: 'cover', slots: { kicker: 'Entrevista · Agro', title: 'A cooperativa que levou o café à xícara' }, sourceBlockIds: ['b1'] },
    { id: 's2', layout: 'data', slots: { title: 'Renda', stat: '+41%', body: 'em três safras, com venda direta.' }, sourceBlockIds: ['b2'], ai: 'unreviewed' },
    { id: 's3', layout: 'list', slots: { title: 'O que mudou', items: 'Torra própria\nProva de cada lote\nContrato direto' }, sourceBlockIds: ['b3'] },
    { id: 's4', layout: 'quote', slots: { quote: 'O preço deixa de ser segredo.', attribution: 'Lúcia Andrade' }, sourceBlockIds: ['b4'] },
    { id: 's5', layout: 'closing', slots: { title: 'Do sítio à xícara', cta: 'Leia a entrevista completa' }, sourceBlockIds: ['b5'] },
  ],
};

describe('switching templates', () => {
  it('the same template changes nothing', () => {
    assert.deepEqual(switchTemplate(BODY, FULL, FULL), { body: BODY, issues: [] });
  });

  it('keeps slide ids, order, origin and review state; maps the cover to the new cover layout', () => {
    const { body } = switchTemplate(BODY, FULL, NARROW);
    assert.equal(body.templateId, NARROW.id);
    assert.deepEqual(
      body.slides.map((slide) => [slide.id, slide.layout, slide.sourceBlockIds]),
      [
        ['s1', 'abertura', ['b1']],
        ['s2', 'point', ['b2']],
        ['s3', 'point', ['b3']],
        ['s4', 'point', ['b4']],
        ['s5', 'closing', ['b5']],
      ],
    );
    assert.equal(body.slides[1].ai, 'unreviewed');
    assert.equal(body.slides[0].slots.headline, 'A cooperativa que levou o café à xícara', 'title by role into another slot id');
  });

  it('joins what the new layout lacks: the figure before its text, list items as lines, the quote with its credit', () => {
    const { body, issues } = switchTemplate(BODY, FULL, NARROW);
    assert.deepEqual(body.slides[1].slots, { title: 'Renda', body: '+41% em três safras, com venda direta.' });
    assert.deepEqual(body.slides[2].slots, { title: 'O que mudou', body: 'Torra própria\nProva de cada lote\nContrato direto' });
    assert.deepEqual(body.slides[3].slots, { body: '“O preço deixa de ser segredo.”\n— Lúcia Andrade' });
    const merged = issues.filter((issue) => issue.kind === 'merged').map((issue) => issue.message);
    assert.deepEqual(merged, [
      'Slide 2: Número foi para Texto.',
      'Slide 3: Itens foi para Texto.',
      'Slide 4: Citação foi para Texto.',
      'Slide 4: Crédito foi para Texto.',
    ]);
    assert.ok(issues.some((issue) => issue.kind === 'layout' && issue.message === 'Slide 2: Número passou a Ponto.'));
  });

  it('reports what has no place, with its text, and what the new model asks for', () => {
    const { issues } = switchTemplate(BODY, FULL, NARROW);
    const dropped = issues.filter((issue) => issue.kind === 'dropped');
    assert.deepEqual(
      dropped.map((issue) => [issue.slideId, issue.slotId, issue.text, issue.message]),
      [
        ['s1', 'kicker', 'Entrevista · Agro', 'Slide 1: Chamada ficou de fora.'],
        ['s5', 'cta', 'Leia a entrevista completa', 'Slide 5: Chamada final ficou de fora.'],
      ],
    );
    assert.ok(issues.some((issue) => issue.kind === 'missing' && issue.slideId === 's4' && issue.message === 'Slide 4: falta título.'));
    assert.ok(issues.some((issue) => issue.kind === 'count' && issue.slideId === 's5'), 'the narrow model takes 4 slides');
  });

  it('flags texts over the new character budget', () => {
    const long: CarouselBody = { ...BODY, slides: [{ id: 'c', layout: 'cover', slots: { title: 'Um título comprido que passa dos quarenta caracteres do modelo' }, sourceBlockIds: [] }] };
    const { issues } = switchTemplate(long, FULL, NARROW);
    assert.deepEqual(
      issues.map((issue) => issue.kind),
      ['layout', 'over_budget'],
    );
    assert.equal(issues[1].message, 'Slide 1: Manchete passa de 40 caracteres.');
  });

  it('a layout the new model lacks falls back in order; an unknown source layout is read by slot id', () => {
    assert.equal(targetLayout(NARROW, FULL, 'context')?.id, 'point');
    assert.equal(targetLayout(NARROW, FULL, 'quote')?.id, 'point');
    assert.equal(targetLayout(NARROW, FULL, 'nada')?.id, 'point', 'first non-cover layout');
    const stray: CarouselBody = { type: 'carousel', templateId: 'sumiu', slides: [{ id: 'x', layout: 'point', slots: { title: 'Título', body: 'Texto' }, sourceBlockIds: [] }] };
    const { body } = switchTemplate(stray, undefined, NARROW);
    assert.deepEqual(body.slides[0].slots, { title: 'Título', body: 'Texto' });
  });
});

describe('changing a slide layout', () => {
  it('a point becomes a list (sentences as items) or a quote (the text as the quote, the title reported)', () => {
    const point = { id: 'p', layout: 'point', slots: { title: 'Qualidade', body: 'Cada lote passa por prova. Abaixo de 84 pontos, fica fora.' }, sourceBlockIds: [] };
    const list = changeSlideLayout(point, FULL, 'list', 3);
    assert.deepEqual(list?.slide.slots, { title: 'Qualidade', items: 'Cada lote passa por prova.\nAbaixo de 84 pontos, fica fora.' });
    const quote = changeSlideLayout(point, FULL, 'quote', 3);
    assert.deepEqual(quote?.slide.slots, { quote: 'Cada lote passa por prova. Abaixo de 84 pontos, fica fora.' });
    assert.ok(quote?.issues.some((issue) => issue.kind === 'dropped' && issue.text === 'Qualidade'));
    assert.equal(changeSlideLayout(point, FULL, 'nada', 3), undefined);
    assert.deepEqual(changeSlideLayout(point, FULL, 'point', 3), { slide: point, issues: [] });
  });
});
