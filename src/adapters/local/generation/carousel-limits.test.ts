import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { paragraphBlock, quoteBlock } from '../../../domain/article.ts';
import type { CarouselBody } from '../../../domain/carousel.ts';
import { PROVISIONAL_TEMPLATES, TEMPLATE_RENDERS } from '../../../fixtures/templates/provisional.ts';
import { runToEnd } from '../../../ports/contracts/generation.contract.ts';
import { createLocalRenderService } from '../render/local-render.ts';
import type { SlotMeasure } from './carousel-assist.ts';
import { extractiveCarouselPlan } from './carousel-plan.ts';
import { fitSlidesToRender, limitsMeta } from './run-carousel.ts';
import { ARTICLE_PIECE, CAROUSEL_PIECE, createHarness, PRODUCTION_ID, TEST_TEMPLATE } from './testing.ts';

/**
 * A12 · "Conferindo limites" asks the render how many lines each slot takes and shortens what
 * overflows before the run ends; the cover's call is "editoria · marca", never just the origin.
 */

/** Stand-in for the renderer: a cover title wraps past its lines above 44 characters. */
const narrowCover: SlotMeasure = (body) =>
  body.slides.flatMap((slide) =>
    slide.layout === 'cover' && slide.slots.title ? [{ slideId: slide.id, slotId: 'title', overflow: slide.slots.title.length > 44 }] : [],
  );

describe('carousel copy · limits step', () => {
  it('shortens a title the render says overflows, before the run completes', async () => {
    const harness = createHarness({ measure: narrowCover });
    await runToEnd(harness.service, 'article.draft', { productionId: PRODUCTION_ID, pieceId: ARTICLE_PIECE });
    harness.addCarouselPiece();
    harness.approveLatestArticle();
    const run = await runToEnd(harness.service, 'carousel.copy', { productionId: PRODUCTION_ID, pieceId: CAROUSEL_PIECE });
    const cover = run.fold.slides[0];
    assert.ok(cover?.slots.title, 'the cover keeps a title');
    assert.ok(cover.slots.title.length <= 44, `"${cover.slots.title}" fits the render`);
    assert.equal((cover.slots.title.match(/“/g) ?? []).length, (cover.slots.title.match(/”/g) ?? []).length, 'a cut quotation is closed');
    const coverEvents = run.events.filter((event) => event.type === 'slide.completed' && event.slide.id === cover.id);
    assert.equal(coverEvents.length, 2, 'streamed once, then replaced by the shortened slide');
    assert.equal(run.fold.run.status, 'completed');
    assert.match(run.fold.run.steps.find((step) => step.id === 'limits')?.meta ?? '', /^1 texto encurtado para caber$/);
    const piece = harness.record().pieces.find((entry) => entry.id === CAROUSEL_PIECE);
    assert.ok(piece?.draft.body.type === 'carousel');
    assert.equal(piece.draft.body.slides[0]?.slots.title, cover.slots.title, 'the settled draft is the fitted one');
  });

  it('measures with the local renderer: lines, not only characters', () => {
    const render = createLocalRenderService({ templates: PROVISIONAL_TEMPLATES, renders: TEMPLATE_RENDERS, createSurface: () => undefined });
    const template = PROVISIONAL_TEMPLATES[0];
    const measure: SlotMeasure = (body) => {
      const measured = render.measure(body);
      return measured.ok ? measured.value : [];
    };
    // Long words wrap early: within the characters, past the cover's lines.
    const long = 'Cooperativa de panificadoras paranaenses compartilha infraestrutura';
    assert.ok(long.length <= 70, 'within the character budget');
    const body: CarouselBody = { type: 'carousel', templateId: template.id, slides: [{ id: 's1', layout: 'cover', slots: { title: long }, sourceBlockIds: [] }] };
    assert.ok(measure(body).some((fit) => fit.slotId === 'title' && fit.overflow), 'but over the 4 lines of the cover');
    const fitted = fitSlidesToRender(body, template, measure);
    assert.equal(fitted.shortened, 1);
    assert.equal(fitted.over, 0);
    assert.ok(!measure({ ...body, slides: fitted.slides }).some((fit) => fit.overflow));
    assert.ok(long.startsWith(fitted.slides[0]?.slots.title ?? '?'), 'a cut of the same words, never new ones');
  });

  it('never ends a cut on a number that lost its noun', () => {
    const template = TEST_TEMPLATE;
    const title = 'Aurora reduz pedido mínimo para 6 pares por modelo';
    const tight: SlotMeasure = (body) => body.slides.map((slide) => ({ slideId: slide.id, slotId: 'title', overflow: (slide.slots.title ?? '').length > 34 }));
    const body: CarouselBody = { type: 'carousel', templateId: template.id, slides: [{ id: 's1', layout: 'cover', slots: { title }, sourceBlockIds: [] }] };
    const fitted = fitSlidesToRender(body, template, tight);
    assert.equal(fitted.slides[0]?.slots.title, 'Aurora reduz pedido mínimo');
  });

  it('never leaves an attribution without its speaker, nor a quotation open', () => {
    const template = TEST_TEMPLATE;
    const title = '“O lojista aprendeu a não apostar tudo numa forma só”, diz Lucas Ferraz';
    const lines: SlotMeasure = (body) => body.slides.map((slide) => ({ slideId: slide.id, slotId: 'title', overflow: (slide.slots.title ?? '').length > 60 }));
    const body: CarouselBody = { type: 'carousel', templateId: template.id, slides: [{ id: 's1', layout: 'cover', slots: { title }, sourceBlockIds: [] }] };
    assert.equal(fitSlidesToRender(body, template, lines).slides[0]?.slots.title, '“O lojista aprendeu a não apostar tudo numa forma só”');
    const tighter: SlotMeasure = (probe) => probe.slides.map((slide) => ({ slideId: slide.id, slotId: 'title', overflow: (slide.slots.title ?? '').length > 40 }));
    const cut = fitSlidesToRender(body, template, tighter).slides[0]?.slots.title ?? '';
    assert.match(cut, /^“.+…”$/, `"${cut}" closes the quotation it cut`);
    assert.doesNotMatch(cut, /,\s*diz$|\bdiz$/);
  });

  it('says what it did', () => {
    assert.equal(limitsMeta({ shortened: 0, over: 0 }), 'Todos os textos cabem');
    assert.equal(limitsMeta({ shortened: 2, over: 0 }), '2 textos encurtados para caber');
    assert.equal(limitsMeta({ shortened: 1, over: 1 }), '1 texto encurtado para caber · 1 texto acima do limite');
  });
});

describe('carousel copy · cover call', () => {
  it('is "editoria · marca" when the article and the people say it', () => {
    let next = 0;
    const plan = extractiveCarouselPlan({
      article: {
        type: 'article',
        title: 'Bijuteria brasileira chega à Europa',
        blocks: [paragraphBlock('p1', 'A exportação já responde por 31% do faturamento, com 64 lojas europeias.')],
      },
      template: TEST_TEMPLATE,
      slides: 3,
      sources: [],
      brand: 'Lume Acessórios',
      newId: (prefix) => `${prefix}-${(next += 1)}`,
    });
    assert.equal(plan.slides[0]?.slots.kicker, 'Exportação · Lume Acessórios');
  });

  it('the quote slide carries a quotation that stands alone, not a four-word aside', () => {
    let next = 0;
    const plan = extractiveCarouselPlan({
      article: {
        type: 'article',
        title: 'Tendências do verão',
        blocks: [
          paragraphBlock('p0', '“Aparece, e com números”, diz Lucas. A rasteira cresceu 28% no último verão.'),
          paragraphBlock('p1', 'O consumidor decide a compra mais perto da estação.'),
          quoteBlock('q1', 'Eu ainda compro solado alto, mas compro menos e com grade mais curta.'),
          paragraphBlock('p2', 'A fábrica que repõe em três semanas ganha espaço na loja.'),
        ],
      },
      template: TEST_TEMPLATE,
      slides: 5,
      sources: [],
      newId: (prefix) => `${prefix}-${(next += 1)}`,
    });
    const quote = plan.slides.find((slide) => slide.layout === 'quote');
    assert.match(quote?.slots.quote ?? '', /^Eu ainda compro solado alto/);
  });

  it('titles the context slide with the working title, never with a label ("Contexto")', () => {
    let next = 0;
    const article = {
      type: 'article' as const,
      title: '“O lojista aprendeu a não apostar tudo numa forma só”, diz Lucas Ferraz',
      blocks: [
        paragraphBlock('p0', 'A rasteira de tira fina cresceu 28% no último verão nas lojas da rede.'),
        paragraphBlock('p1', 'O consumidor decide a compra mais perto da estação.'),
      ],
    };
    const plan = (subject: string | undefined) =>
      extractiveCarouselPlan({ article, template: TEST_TEMPLATE, slides: 5, sources: [], ...(subject ? { subject } : {}), newId: (prefix) => `${prefix}-${(next += 1)}` });
    const context = (slides: ReturnType<typeof plan>['slides']) => slides.find((slide) => slide.layout === 'context');
    assert.equal(context(plan('Tendências do verão 2027').slides)?.slots.title, 'Tendências do verão 2027');
    assert.equal(plan('Tendências do verão 2027').slides[0]?.slots.kicker, 'Tendências');
    const untitled = context(plan(undefined).slides);
    assert.ok(untitled && untitled.slots.title === undefined && untitled.slots.body, 'no working title: the text alone');
    assert.ok(plan('Moda').slides.every((slide) => slide.slots.title !== 'Contexto'));
  });
});
