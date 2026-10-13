import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { headingBlock, paragraphBlock, plannedLayouts, quoteBlock } from '../../../domain/index.ts';
import type { ArticleBody, CarouselBody, CarouselTemplate, Slide } from '../../../domain/index.ts';
import { cutAtWord, fitSentences, sentences, standalone, titlePhrase, trimDangling } from '../../../domain/text/slide-text.ts';
import { applyProposal, fitSlide, rewriteSlide, swapPoint, updateProposals } from './slide-assist.ts';

const TEMPLATE: CarouselTemplate = {
  id: 'tpl',
  name: 'Modelo',
  width: 1080,
  height: 1350,
  minSlides: 3,
  maxSlides: 10,
  coverLayoutId: 'cover',
  layouts: [
    { id: 'cover', label: 'Capa', slots: [{ id: 'title', label: 'Título', role: 'title', maxChars: 70, required: true }] },
    { id: 'context', label: 'Contexto', slots: [{ id: 'title', label: 'Título', role: 'title', maxChars: 40 }, { id: 'body', label: 'Texto', role: 'body', maxChars: 200 }] },
    { id: 'point', label: 'Ponto principal', slots: [{ id: 'title', label: 'Título', role: 'title', maxChars: 40 }, { id: 'body', label: 'Texto', role: 'body', maxChars: 120 }] },
    { id: 'quote', label: 'Citação', slots: [{ id: 'quote', label: 'Citação', role: 'quote', maxChars: 140 }, { id: 'attribution', label: 'Crédito', role: 'attribution', maxChars: 60 }] },
    { id: 'closing', label: 'Conclusão', slots: [{ id: 'title', label: 'Título', role: 'title', maxChars: 50 }, { id: 'body', label: 'Texto', role: 'body', maxChars: 160 }] },
  ],
};

const ARTICLE: ArticleBody = {
  type: 'article',
  title: 'Curtume transforma aparas em nova linha de produtos',
  blocks: [
    paragraphBlock('p1', 'O curtume recolhe aparas nos clientes. As peças maiores viram chaveiros. As menores viram um laminado para forros.'),
    headingBlock('h1', 'Logística reversa'),
    paragraphBlock('p2', 'O caminhão que entrega couro volta com as aparas. A mudança tornou o projeto viável.'),
    quoteBlock('q1', 'Aparas de couro não deveriam ser lixo em lugar nenhum.'),
    headingBlock('h2', 'Próximos passos'),
    paragraphBlock('p3', 'A meta é dobrar o volume em dois anos.'),
  ],
};

const slide = (id: string, layout: string, slots: Record<string, string>, sourceBlockIds: string[]): Slide => ({ id, layout, slots, sourceBlockIds, ai: 'unreviewed' });

const SLIDES: Slide[] = [
  slide('s1', 'cover', { title: ARTICLE.title }, []),
  slide('s2', 'point', { title: 'Aparas viram produto', body: 'O curtume recolhe aparas nos clientes.' }, ['p1']),
  slide('s3', 'quote', { quote: 'Aparas de couro não deveriam ser lixo em lugar nenhum.', attribution: 'Caio' }, ['q1']),
];

describe('slide text', () => {
  it('splits sentences and fits whole sentences before cutting words', () => {
    assert.deepEqual(sentences('Uma frase. Outra frase! Fim'), ['Uma frase.', 'Outra frase!', 'Fim']);
    assert.equal(fitSentences('Primeira frase curta. Segunda frase bem mais longa que o limite.', 25), 'Primeira frase curta.');
    assert.match(fitSentences('Uma única frase longa demais para caber no espaço', 20), /…$/);
    assert.equal(standalone('Para isso, o curtume conversa.'), 'O curtume conversa.');
    assert.equal(titlePhrase('Logística: o caminhão volta cheio de aparas.', 20), 'Logística');
  });
});

describe('slide assist', () => {
  it('rewrites the body with other sentences of the same article block', () => {
    const result = rewriteSlide({ slide: SLIDES[1], template: TEMPLATE, article: ARTICLE, slides: SLIDES });
    assert.ok(result.ok);
    assert.match(result.proposal.slots.body, /As peças maiores viram chaveiros/);
  });

  it('keeps quotations literal', () => {
    const result = rewriteSlide({ slide: SLIDES[2], template: TEMPLATE, article: ARTICLE, slides: SLIDES });
    assert.equal(result.ok, false);
  });

  it('shortens only what overflows, until the renderer says it fits', () => {
    const long = slide('s4', 'point', { title: 'Logística reversa: o caminhão volta cheio', body: 'O caminhão que entrega couro volta com as aparas. A mudança tornou o projeto viável.' }, ['p2']);
    const result = fitSlide({ slide: long, template: TEMPLATE }, new Set(['title']), (_slot, text) => text.length <= 20);
    assert.ok(result.ok);
    assert.equal(result.proposal.slots.title, 'Logística reversa');
    assert.equal(result.proposal.slots.body, undefined);
    const none = fitSlide({ slide: SLIDES[1], template: TEMPLATE }, new Set(), () => true);
    assert.equal(none.ok, false);
  });

  it('swaps to a paragraph no other slide uses, with its section heading', () => {
    const result = swapPoint({ slide: SLIDES[1], template: TEMPLATE, article: ARTICLE, slides: SLIDES });
    assert.ok(result.ok);
    assert.deepEqual(result.proposal.sourceBlockIds, ['h1', 'p2']);
    assert.equal(result.proposal.slots.title, 'Logística reversa');
    const cover = swapPoint({ slide: SLIDES[0], template: TEMPLATE, article: ARTICLE, slides: SLIDES });
    assert.equal(cover.ok, false);
  });

  it('proposes updates only for slides whose article blocks changed', () => {
    const after: ArticleBody = {
      ...ARTICLE,
      title: 'Curtume recolhe 11 toneladas de aparas',
      blocks: ARTICLE.blocks.map((block) =>
        block.id === 'p1' ? paragraphBlock('p1', 'O curtume recolhe aparas sem custo. As peças maiores viram chaveiros. As menores viram um laminado para forros.') : block,
      ),
    };
    const body: CarouselBody = { type: 'carousel', templateId: 'tpl', slides: SLIDES };
    const proposals = updateProposals(body, TEMPLATE, ARTICLE, after);
    assert.deepEqual(
      proposals.map((proposal) => proposal.slideId),
      ['s1', 's2'],
    );
    assert.equal(proposals[0].slots.title, 'Curtume recolhe 11 toneladas de aparas');
    assert.match(proposals[1].slots.body, /sem custo/);
    const applied = applyProposal(SLIDES[1], proposals[1]);
    assert.equal(applied.ai, 'reviewed');
    assert.equal(applied.slots.title, 'Aparas viram produto');
  });

  it('plans the default structure by slide count', () => {
    assert.deepEqual(
      plannedLayouts(TEMPLATE, 5).map((layout) => layout.id),
      ['cover', 'context', 'point', 'quote', 'closing'],
    );
    assert.equal(plannedLayouts(TEMPLATE, 7).length, 7);
    assert.equal(plannedLayouts(TEMPLATE, 1).length, 3);
  });
});

describe('word cuts', () => {
  it('never end on an article, preposition or conjunction', () => {
    assert.equal(trimDangling('Oficina Vento transforma lona de caminhão em'), 'Oficina Vento transforma lona de caminhão');
    assert.equal(trimDangling('A feira mudou tudo para a'), 'A feira mudou tudo');
    assert.equal(cutAtWord('A lona de caminhão dura uns cinco anos na estrada', 28), 'A lona de caminhão dura');
  });
});
