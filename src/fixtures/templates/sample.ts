import type { SampleContent } from '../../ports/render-template.ts';

/**
 * Sample copy of the library previews: one short interview about a fictional coffee cooperative,
 * one entry per layout, within every model's budgets (`catalog.test.ts` measures it). It shows
 * how a model sets each kind of slide; it is never a production's text.
 */
export const SAMPLE_CONTENT: SampleContent = {
  cover: { kicker: 'Entrevista · Agro', title: 'A cooperativa que levou o café do sítio à xícara' },
  context: {
    title: 'O começo',
    body: 'Em 2018, nove produtoras dividiam um secador. Hoje são 64 famílias, com torra própria e venda direta.',
  },
  point: {
    title: 'Qualidade medida',
    body: 'Cada lote passa por prova antes de sair. Abaixo de 84 pontos, o café não leva a marca da cooperativa.',
  },
  data: { title: 'Renda das famílias', stat: '+41%', body: 'em três safras, com venda direta às cafeterias da região.' },
  list: {
    title: 'O que mudou na cooperativa',
    items: 'Torra própria em vez de grão cru\nProva de cada lote antes da venda\nContrato direto com cafeterias',
  },
  quote: { quote: 'Quando a gente prova o café junto, o preço deixa de ser segredo.', attribution: 'Lúcia Andrade, presidente da cooperativa' },
  closing: {
    title: 'Do sítio à xícara',
    body: 'A cooperativa agora ensina o método a outras 12 associações da região.',
    cta: 'Leia a entrevista completa',
  },
};
