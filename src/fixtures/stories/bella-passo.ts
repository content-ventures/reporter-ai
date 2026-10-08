import type { ArticleBody, CarouselBody, Source } from '../../domain/index.ts';
import { applyEdits, buildDraftScript, h2, p, quote, reviewAll } from '../build/article.ts';
import type { ArticleSpec } from '../build/article.ts';
import { startScenario } from '../build/scenario.ts';
import { buildTranscriptSource } from '../build/source.ts';
import { PEOPLE } from '../people.ts';
import { scriptBody } from '../script-book.ts';
import type { ScriptEntry, SlideCopy } from '../script-book.ts';
import { NEUTRAL_LIGHT_TEMPLATE_ID } from '../templates/provisional.ts';
import { after, ago, dateOf, HOUR_MS } from '../time.ts';
import { slidesFrom } from './slides.ts';
import type { Story, StoryContext } from './types.ts';

/**
 * State: concluded (gray). Article v2 and carousel v2 approved, package exported with the
 * manifest, and the pilot feedback recorded (REQ-T.8) with automatic stage timings.
 */

export const BELLA_PASSO_TRANSCRIPT = [
  'Clara Souto: Gustavo, a Bella Passo mudou a forma de desenvolver calçado infantil. O que motivou a mudança?',
  'Gustavo Hoff: Uma reclamação que se repetia. As mães diziam que o sapato ficava pequeno antes de gastar. A criança de três a seis anos troca de numeração em média a cada quatro meses, e o sapato dura bem mais do que isso. Resolvemos desenhar um calçado que acompanhasse esse crescimento por mais tempo.',
  'Clara Souto: Como funciona esse calçado?',
  'Gustavo Hoff: O cabedal tem uma área elástica na frente e uma palmilha removível com duas espessuras. Quando o pé cresce, a família tira a palmilha mais grossa e coloca a fina. Na prática, o mesmo par atende uma numeração e meia. Testamos com 120 crianças durante oito meses antes de lançar.',
  'Clara Souto: O que os testes mostraram?',
  'Gustavo Hoff: Que o tempo de uso aumentou, em média, 40%. E mostraram coisas que a gente não esperava. As crianças tiravam a palmilha para brincar, então tivemos que mudar o encaixe para ela não sair com facilidade. E os pais não entendiam o sistema pela caixa, então criamos um vídeo curto com um código na etiqueta.',
  'Clara Souto: Isso não reduz as vendas, já que a família compra menos pares?',
  'Gustavo Hoff: Essa foi a primeira pergunta do nosso comercial. A resposta veio do mercado: as famílias que compram a linha voltam para a marca. O lojista passou a vender a Bella Passo como uma escolha mais inteligente, não como um sapato mais caro. Vender menos pares para a mesma família virou motivo para ela não procurar outra marca.',
  'Clara Souto: E o preço?',
  'Gustavo Hoff: O par custa cerca de 15% mais do que a nossa linha tradicional. Quando o lojista explica que o sapato dura mais, a diferença deixa de ser obstáculo. Treinamos as vendedoras de 300 lojas para fazer essa explicação em menos de um minuto.',
  'Clara Souto: E os materiais?',
  'Gustavo Hoff: Usamos couro de curtimento sem cromo no cabedal e um solado de borracha natural mais macio, porque pé de criança precisa de flexibilidade. Cada material passa por teste de substâncias restritas, já que a criança coloca tudo na boca. Nesse produto, segurança vem antes de qualquer tendência.',
  'Clara Souto: Como foi o desenvolvimento com os pediatras?',
  'Gustavo Hoff: Trabalhamos com uma fisioterapeuta especializada em pés infantis desde o primeiro desenho. Ela vetou duas versões que pareciam ótimas no papel, porque apertavam o dedão quando a criança corria. A regra que ficou foi simples: o sapato tem que deixar o pé trabalhar. Calçado infantil não pode corrigir nem imobilizar, tem que proteger e sair do caminho.',
  'Clara Souto: E como o lojista recebeu a novidade?',
  'Gustavo Hoff: Com desconfiança, porque toda marca diz que o seu sapato é especial. O que convenceu foi a palmilha na mão. A gente mandou para cada loja um kit com as duas palmilhas e um pé de demonstração. Quando a vendedora mostra a troca para a mãe, a venda acontece na hora.',
  'Clara Souto: Qual o próximo passo?',
  'Gustavo Hoff: Levar o mesmo princípio para a sandália, que é o nosso produto mais vendido no verão. É mais difícil, porque a sandália tem menos estrutura para esconder o ajuste. Já temos três protótipos em teste com famílias de funcionários. Se der certo, lançamos na próxima coleção de verão.',
  'Clara Souto: Como vocês acompanham o uso depois da venda?',
  'Gustavo Hoff: Pelo cadastro da garantia. A família registra o par no site e, quando troca a palmilha, recebe um lembrete para conferir o tamanho. Mais de dois mil pares já foram registrados. Com esses dados, a gente descobriu que a palmilha fina entra, em média, no quinto mês de uso, e ajustou a orientação que vai na caixa.',
].join('\n\n');

export const BELLA_PASSO_ARTICLE: ArticleSpec = {
  title: 'Bella Passo cria calçado infantil que acompanha o crescimento do pé',
  keyExcerpts: [
    'As mães diziam que o sapato ficava pequeno antes de gastar.',
    'o mesmo par atende uma numeração e meia',
    'Nesse produto, segurança vem antes de qualquer tendência.',
  ],
  sections: [
    {
      id: 'intro',
      blocks: [
        p(
          'bp-intro-1',
          'A Bella Passo redesenhou seu calçado infantil a partir de uma queixa recorrente das famílias: o sapato ficava pequeno antes de gastar. Entre três e seis anos, a criança troca de numeração em média a cada quatro meses, e o calçado dura bem mais do que isso. A nova linha foi pensada para acompanhar esse crescimento por mais tempo.',
          'As mães diziam que o sapato ficava pequeno antes de gastar.',
          'A criança de três a seis anos troca de numeração em média a cada quatro meses, e o sapato dura bem mais do que isso.',
        ),
      ],
    },
    {
      id: 'section-1',
      blocks: [
        h2('bp-h1', 'Uma palmilha, duas espessuras'),
        p(
          'bp-s1-p1',
          'O cabedal tem uma área elástica na frente, e a palmilha removível vem em duas espessuras. Quando o pé cresce, a família troca a palmilha grossa pela fina, e o mesmo par passa a atender uma numeração e meia. Antes do lançamento, o modelo foi testado com 120 crianças durante oito meses.',
          'O cabedal tem uma área elástica na frente e uma palmilha removível com duas espessuras.',
          'o mesmo par atende uma numeração e meia',
          'Testamos com 120 crianças durante oito meses antes de lançar.',
        ),
        p(
          'bp-s1-p2',
          'Os testes mostraram aumento médio de 40% no tempo de uso e alguns imprevistos. As crianças tiravam a palmilha para brincar, o que levou a um novo encaixe, e os pais não entendiam o sistema pela caixa, o que gerou um vídeo curto acessado por um código na etiqueta.',
          'Que o tempo de uso aumentou, em média, 40%.',
          'As crianças tiravam a palmilha para brincar',
          'criamos um vídeo curto com um código na etiqueta',
        ),
        p(
          'bp-s1-p3',
          'Uma fisioterapeuta especializada em pés infantis acompanhou o projeto desde o primeiro desenho e vetou duas versões que apertavam o dedão quando a criança corria. A regra que ficou, segundo o diretor de produto Gustavo Hoff, é que o calçado infantil não deve corrigir nem imobilizar o pé, e sim protegê-lo e deixá-lo trabalhar.',
          'Trabalhamos com uma fisioterapeuta especializada em pés infantis desde o primeiro desenho.',
          'Ela vetou duas versões que pareciam ótimas no papel, porque apertavam o dedão quando a criança corria.',
          'Calçado infantil não pode corrigir nem imobilizar, tem que proteger e sair do caminho.',
        ),
        p(
          'bp-s1-p4',
          'O uso é acompanhado pelo cadastro da garantia: a família registra o par no site e, ao trocar a palmilha, recebe um lembrete para conferir o tamanho. Com mais de dois mil pares registrados, a marca descobriu que a palmilha fina entra, em média, no quinto mês de uso, e ajustou a orientação que vai na caixa.',
          'Pelo cadastro da garantia.',
          'A família registra o par no site e, quando troca a palmilha, recebe um lembrete para conferir o tamanho.',
          'Mais de dois mil pares já foram registrados.',
          'a palmilha fina entra, em média, no quinto mês de uso',
        ),
      ],
    },
    {
      id: 'section-2',
      blocks: [
        h2('bp-h2', 'Vender menos pares e fidelizar'),
        p(
          'bp-s2-p1',
          'A dúvida do comercial era se a linha reduziria as vendas. Aconteceu o contrário: as famílias que compram a linha voltam para a marca, e o lojista passou a apresentar a Bella Passo como uma escolha mais inteligente. “Vender menos pares para a mesma família virou motivo para ela não procurar outra marca”, diz Gustavo.',
          'as famílias que compram a linha voltam para a marca',
          'O lojista passou a vender a Bella Passo como uma escolha mais inteligente, não como um sapato mais caro.',
          'Vender menos pares para a mesma família virou motivo para ela não procurar outra marca.',
        ),
        p(
          'bp-s2-p2',
          'O par custa cerca de 15% mais do que a linha tradicional, e as vendedoras de 300 lojas foram treinadas para explicar a proposta em menos de um minuto. Cada loja recebeu um kit com as duas palmilhas e um pé de demonstração: quando a vendedora mostra a troca para a mãe, a venda acontece na hora.',
          'O par custa cerca de 15% mais do que a nossa linha tradicional.',
          'Treinamos as vendedoras de 300 lojas para fazer essa explicação em menos de um minuto.',
          'A gente mandou para cada loja um kit com as duas palmilhas e um pé de demonstração.',
          'Quando a vendedora mostra a troca para a mãe, a venda acontece na hora.',
        ),
        p(
          'bp-s2-p3',
          'O cabedal usa couro de curtimento sem cromo, o solado é de borracha natural mais macia e cada material passa por teste de substâncias restritas, já que a criança leva tudo à boca.',
          'Usamos couro de curtimento sem cromo no cabedal e um solado de borracha natural mais macio',
          'Cada material passa por teste de substâncias restritas, já que a criança coloca tudo na boca.',
        ),
        quote('bp-q1', 'Nesse produto, segurança vem antes de qualquer tendência.'),
        p(
          'bp-s2-p4',
          'O próximo passo é levar o mesmo princípio à sandália, o produto mais vendido da marca no verão. Três protótipos estão em teste com famílias de funcionários e, se der certo, a sandália chega na próxima coleção de verão.',
          'Levar o mesmo princípio para a sandália, que é o nosso produto mais vendido no verão.',
          'Já temos três protótipos em teste com famílias de funcionários.',
          'Se der certo, lançamos na próxima coleção de verão.',
        ),
      ],
    },
  ],
};

export const BELLA_PASSO_SLIDES: SlideCopy[] = [
  { layout: 'cover', slots: { kicker: 'Produto · Bella Passo', title: 'O calçado infantil que acompanha o crescimento' }, sourceBlockIds: ['bp-intro-1'] },
  {
    layout: 'context',
    slots: { title: 'Pequeno antes de gastar', body: 'Entre três e seis anos, a criança troca de numeração em média a cada quatro meses.' },
    sourceBlockIds: ['bp-intro-1'],
  },
  {
    layout: 'point',
    slots: { title: 'Duas palmilhas, um par', body: 'A palmilha removível tem duas espessuras. O mesmo par atende uma numeração e meia, com 40% mais tempo de uso.' },
    sourceBlockIds: ['bp-s1-p1', 'bp-s1-p2'],
  },
  {
    layout: 'quote',
    slots: { quote: 'Nesse produto, segurança vem antes de qualquer tendência.', attribution: 'Gustavo Hoff, diretor de produto da Bella Passo' },
    sourceBlockIds: ['bp-q1'],
  },
  {
    layout: 'closing',
    slots: { title: 'Próximo passo: a sandália', body: 'Três protótipos já estão em teste com famílias de funcionários.', cta: 'Leia a matéria completa' },
    sourceBlockIds: ['bp-s2-p4'],
  },
];

export function bellaPassoScripts(source: Source): ScriptEntry {
  return {
    sourceId: source.id,
    draft: buildDraftScript(source, BELLA_PASSO_ARTICLE),
    titles: [
      'Um par, uma numeração e meia: a aposta da Bella Passo',
      'Bella Passo vende menos pares e ganha a fidelidade das famílias',
      'O calçado infantil que dura mais do que o pé demora a crescer',
    ],
    subheadings: ['Como o par acompanha o pé', 'Menos pares, mais fidelidade'],
    carousel: BELLA_PASSO_SLIDES,
  };
}

export function bellaPassoStory(ctx: StoryContext): Story {
  const createdAt = ago(ctx.now, { days: 12, hours: 3 });
  const source = buildTranscriptSource({
    id: 'src-bella-passo',
    title: 'Entrevista Bella Passo: calçado que cresce com a criança',
    origin: 'interview',
    text: BELLA_PASSO_TRANSCRIPT,
    fileName: 'entrevista-bella-passo.txt',
    speakers: { 'Clara Souto': PEOPLE.clara, 'Gustavo Hoff': PEOPLE.gustavo },
    authorized: true,
    recordedOn: dateOf(ago(ctx.now, { days: 15 })),
    createdAt,
    createdBy: PEOPLE.joao,
  });
  const script = bellaPassoScripts(source);
  if (!script.draft) throw new Error('bella-passo: missing draft');
  const builder = startScenario({
    key: 'bella-passo',
    title: 'Bella Passo: calçado infantil que cresce com a criança',
    source,
    ownerId: PEOPLE.joao,
    createdAt,
    brief: { angle: 'Como um produto que dura mais fideliza as famílias', sections: 2, length: 'short', revision: 1 },
    plan: ['article', 'carousel'],
    templates: ctx.templates,
  });
  const generatedAt = after(createdAt, { minutes: 3 });
  const v1 = builder.generate('article', { body: scriptBody(script.draft), endedAt: generatedAt, durationMs: 47_000, by: PEOPLE.joao });
  const v2Body = reviewAll(
    applyEdits(source, v1.body as ArticleBody, [{ type: 'title', text: 'Bella Passo lança calçado infantil que acompanha o crescimento do pé' }]),
  );
  builder.saveEdit('article', v2Body, ago(ctx.now, { days: 11, hours: 5 }), PEOPLE.joao);
  builder.requestReview('article', ago(ctx.now, { days: 11, hours: 4 }), PEOPLE.joao);
  const articleApproval = builder.decide('article', 'approved', ago(ctx.now, { days: 10, hours: 22 }), PEOPLE.pedro);

  builder.startCarousel(NEUTRAL_LIGHT_TEMPLATE_ID, ago(ctx.now, { days: 9, hours: 6 }), PEOPLE.joao);
  const carousel: CarouselBody = { type: 'carousel', templateId: NEUTRAL_LIGHT_TEMPLATE_ID, slides: slidesFrom('bella-passo', BELLA_PASSO_SLIDES) };
  builder.generate('carousel', { body: carousel, endedAt: ago(ctx.now, { days: 9, hours: 5, minutes: 55 }), durationMs: 33_000, by: PEOPLE.joao });
  const edited: CarouselBody = {
    ...carousel,
    slides: carousel.slides.map((slide, index) =>
      index === 0 ? { ...slide, slots: { ...slide.slots, title: 'Um par que acompanha o pé da criança' }, ai: 'reviewed' as const } : { ...slide, ai: 'reviewed' as const },
    ),
  };
  builder.saveEdit('carousel', edited, ago(ctx.now, { days: 9, hours: 4 }), PEOPLE.juliana);
  builder.requestReview('carousel', ago(ctx.now, { days: 9, hours: 3 }), PEOPLE.joao);
  builder.decide('carousel', 'approved', ago(ctx.now, { days: 8, hours: 23 }), PEOPLE.juliana);

  const deliveredAt = ago(ctx.now, { days: 8, hours: 21 });
  builder.deliver(deliveredAt, PEOPLE.joao);
  const created = Date.parse(createdAt);
  const approvedAt = Date.parse(articleApproval.at);
  builder.scenario.feedback.push({
    id: builder.newId('fb'),
    target: { kind: 'production', productionId: builder.record.production.id },
    rating: 'positive',
    note: 'Pacote saiu certo na primeira exportação. O carrossel só precisou de um ajuste no título da capa.',
    durations: {
      article: approvedAt - created,
      carousel: Date.parse(deliveredAt) - approvedAt - 2 * HOUR_MS,
      delivery: 2 * HOUR_MS,
    },
    by: PEOPLE.joao,
    at: after(deliveredAt, { minutes: 4 }),
  });
  return {
    scenario: builder.scenario,
    script,
    expect: {
      label: 'Concluída e exportada',
      productionStatus: 'completed',
      pieces: { article: 'approved', carousel: 'approved' },
      draftQuotes: { verified: 2, total: 2 },
    },
  };
}
