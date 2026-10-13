import { localDateOf } from '../../domain/index.ts';
import type { ArticleBody, CarouselBody, Source } from '../../domain/index.ts';
import { applyEdits, buildDraftScript, h2, img, p, quote, reviewAll } from '../build/article.ts';
import type { ArticleSpec } from '../build/article.ts';
import { startScenario } from '../build/scenario.ts';
import { buildTranscriptSource } from '../build/source.ts';
import { PEOPLE } from '../people.ts';
import { scriptBody } from '../script-book.ts';
import type { ScriptEntry, SlideCopy } from '../script-book.ts';
import { NEUTRAL_DARK_TEMPLATE_ID } from '../templates/provisional.ts';
import { after, ago, dateOf } from '../time.ts';
import { slidesFrom } from './slides.ts';
import type { Story, StoryContext } from './types.ts';

/**
 * State: article approved (v2) and carousel v1 · IA, made from that exact version, waiting for
 * approval. The carousel gate accepts the creative reviewer (Juliana) or the approver (Pedro).
 */

export const LUME_TRANSCRIPT = [
  'Rafael Dias: Renata, como a Lume começou a vender para a Europa?',
  'Renata Vidal: Por uma loja de museu em Lisboa. Em 2021 a compradora viu nossas peças numa feira de acessórios aqui no Brasil e encomendou trezentas unidades de uma coleção inspirada em azulejos. Vendeu tudo em seis semanas. Ela indicou a gente para outras duas lojas, e foi assim que a Europa começou, de boca em boca.',
  'Rafael Dias: Hoje quantas lojas compram de vocês lá fora?',
  'Renata Vidal: São 64 lojas em sete países, a maioria independente. Portugal e Espanha concentram mais da metade. A exportação já representa 31% do faturamento da Lume, e a gente cresce lá fora mais rápido do que aqui.',
  'Rafael Dias: O que o comprador europeu procura numa bijuteria brasileira?',
  'Renata Vidal: Cor e história. Eles não querem uma peça que poderia ter sido feita em qualquer lugar. Querem saber que aquela pulseira foi montada à mão por uma artesã em Minas Gerais, com sementes e metal reaproveitado. Cada peça sai com um cartão que conta quem fez e com que material. Esse cartão vende mais do que qualquer vitrine.',
  'Rafael Dias: Como funciona a produção?',
  'Renata Vidal: Trabalhamos com uma rede de 38 artesãs, organizadas em quatro núcleos. A Lume desenha, compra o material, faz o controle de qualidade e cuida da venda. As artesãs recebem por peça, com um valor que a gente revisa a cada coleção junto com elas. Nenhuma peça sai sem passar pela conferência final aqui no ateliê.',
  'Rafael Dias: Quais foram as dificuldades da exportação?',
  'Renata Vidal: A embalagem e a regra de cada país. Bijuteria tem limite de níquel na Europa, e no começo a gente nem sabia disso. Tivemos que trocar fornecedor de metal e mandar peças para laboratório. Foi caro, mas hoje todo lote sai com laudo. A outra dificuldade foi o frete: peça pequena e leve parece fácil de mandar, mas o custo por envio pesa muito quando o pedido é pequeno.',
  'Rafael Dias: E como vocês resolveram o frete?',
  'Renata Vidal: Juntando pedidos. Hoje embarcamos uma vez por mês para a Europa, com todos os pedidos consolidados, e uma parceira em Lisboa faz a distribuição local. O lojista espera um pouco mais, mas paga um frete muito menor. A maioria prefere assim.',
  'Rafael Dias: Como vocês atendem lojas tão distantes?',
  'Renata Vidal: Com catálogo digital e muita foto de detalhe. A cada coleção mandamos para as lojas um catálogo com a história de cada peça e da artesã que fez. Duas vezes por ano eu viajo para visitar as maiores clientes e ouvir o que está vendendo. Essas visitas valem mais do que qualquer relatório.',
  'Rafael Dias: As coleções para fora são diferentes das daqui?',
  'Renata Vidal: Um pouco. O europeu prefere peças mais leves e cores mais terrosas no inverno, enquanto aqui vende mais cor o ano inteiro. Mas a base é a mesma. A gente faz duas coleções por ano e adapta umas dez peças de cada coleção para o mercado de fora. Criar uma coleção só para exportação seria perder a identidade.',
  'Rafael Dias: Qual o próximo passo?',
  'Renata Vidal: Queremos formar mais artesãs. A demanda cresce mais rápido do que a nossa capacidade de produzir à mão, e eu não quero industrializar a Lume. Estamos abrindo um quinto núcleo no ano que vem, com doze novas artesãs. Crescer devagar faz parte do produto.',
  'Rafael Dias: Como vocês definem o preço lá fora?',
  'Renata Vidal: Partimos do preço que a peça precisa ter na vitrine europeia e fazemos a conta de trás para frente. A loja costuma multiplicar por dois e meio o que paga para nós. Com o frete consolidado e o laudo, nossa margem lá fora ficou parecida com a daqui. A diferença é que o pedido europeu é maior e chega com seis meses de antecedência.',
].join('\n\n');

export const LUME_ARTICLE: ArticleSpec = {
  title: 'Lume Acessórios leva bijuteria artesanal a 64 lojas europeias',
  coverSlot: { subject: 'Renata Vidal com peças da coleção inspirada em azulejos', suggestedCaption: 'Renata Vidal, fundadora da Lume Acessórios', suggestedAlt: 'Renata Vidal segura bijuterias da Lume', orientation: 'landscape' },
  keyExcerpts: ['Por uma loja de museu em Lisboa.', 'Esse cartão vende mais do que qualquer vitrine.', 'Crescer devagar faz parte do produto.'],
  sections: [
    {
      id: 'intro',
      blocks: [
        p(
          'lu-intro-1',
          'A Lume Acessórios chegou à Europa por uma loja de museu em Lisboa. Em 2021, a compradora conheceu as peças numa feira de acessórios no Brasil, encomendou trezentas unidades de uma coleção inspirada em azulejos e vendeu tudo em seis semanas. Hoje a marca está em 64 lojas de sete países, a maioria independente, e a exportação responde por 31% do faturamento. Portugal e Espanha concentram mais da metade dessas lojas.',
          'Por uma loja de museu em Lisboa.',
          'encomendou trezentas unidades de uma coleção inspirada em azulejos',
          'Vendeu tudo em seis semanas.',
          'São 64 lojas em sete países, a maioria independente.',
          'A exportação já representa 31% do faturamento da Lume',
          'Portugal e Espanha concentram mais da metade.',
        ),
        img(
          'lu-img-1',
          { subject: 'Peças da coleção inspirada em azulejos', suggestedCaption: 'A coleção inspirada em azulejos abriu a primeira loja europeia', suggestedAlt: 'Bijuterias da Lume inspiradas em azulejos', orientation: 'landscape' },
          'encomendou trezentas unidades de uma coleção inspirada em azulejos',
        ),
      ],
    },
    {
      id: 'section-1',
      blocks: [
        h2('lu-h1', 'Cor, história e um cartão'),
        p(
          'lu-s1-p1',
          'Segundo a fundadora Renata Vidal, o comprador europeu procura peças que não poderiam ter sido feitas em qualquer lugar. Ele quer saber que a pulseira foi montada à mão por uma artesã em Minas Gerais. Cada bijuteria sai com um cartão que identifica a artesã e o material usado, como sementes e metal reaproveitado.',
          'Eles não querem uma peça que poderia ter sido feita em qualquer lugar.',
          'Querem saber que aquela pulseira foi montada à mão por uma artesã em Minas Gerais',
          'Cada peça sai com um cartão que conta quem fez e com que material.',
        ),
        quote('lu-q1', 'Esse cartão vende mais do que qualquer vitrine.'),
        p(
          'lu-s1-p2',
          'A produção depende de uma rede de 38 artesãs organizadas em quatro núcleos. A Lume desenha, compra o material, faz o controle de qualidade e cuida da venda; as artesãs recebem por peça, com valores revisados com elas a cada coleção. Nenhuma peça sai sem a conferência final no ateliê.',
          'Trabalhamos com uma rede de 38 artesãs, organizadas em quatro núcleos.',
          'As artesãs recebem por peça, com um valor que a gente revisa a cada coleção junto com elas.',
          'Nenhuma peça sai sem passar pela conferência final aqui no ateliê.',
        ),
        p(
          'lu-s1-p3',
          'As coleções para fora seguem a mesma base. A marca lança duas coleções por ano e adapta cerca de dez peças de cada uma ao gosto europeu, com peças mais leves e cores terrosas no inverno. Criar uma linha só para exportação, diz Renata, seria perder a identidade.',
          'O europeu prefere peças mais leves e cores mais terrosas no inverno',
          'A gente faz duas coleções por ano e adapta umas dez peças de cada coleção para o mercado de fora.',
          'Criar uma coleção só para exportação seria perder a identidade.',
        ),
      ],
    },
    {
      id: 'section-2',
      blocks: [
        h2('lu-h2', 'Laudo, frete e crescimento devagar'),
        p(
          'lu-s2-p1',
          'A exportação trouxe exigências que a empresa desconhecia, como o limite de níquel em bijuterias na Europa. A Lume trocou o fornecedor de metal, mandou peças para laboratório e passou a enviar cada lote com laudo. Foi caro, reconhece Renata, mas resolveu a exigência.',
          'Bijuteria tem limite de níquel na Europa, e no começo a gente nem sabia disso.',
          'Tivemos que trocar fornecedor de metal e mandar peças para laboratório.',
          'hoje todo lote sai com laudo',
        ),
        p(
          'lu-s2-p2',
          'O frete também pesava nos pedidos pequenos. A solução foi consolidar os envios: uma vez por mês, todos os pedidos seguem juntos para a Europa, e uma parceira em Lisboa faz a distribuição local. O lojista espera um pouco mais, mas paga um frete bem menor.',
          'o custo por envio pesa muito quando o pedido é pequeno',
          'Hoje embarcamos uma vez por mês para a Europa, com todos os pedidos consolidados',
          'O lojista espera um pouco mais, mas paga um frete muito menor.',
        ),
        img(
          'lu-img-2',
          { subject: 'Pedidos consolidados prontos para o embarque mensal à Europa', suggestedCaption: 'Uma vez por mês, todos os pedidos seguem juntos para a Europa', suggestedAlt: 'Caixas com pedidos da Lume prontas para embarque', orientation: 'landscape' },
          'Hoje embarcamos uma vez por mês para a Europa, com todos os pedidos consolidados',
        ),
        p(
          'lu-s2-p2b',
          'O relacionamento com as lojas é mantido à distância, com um catálogo digital que conta a história de cada peça e da artesã, e com duas viagens por ano para visitar as maiores clientes. Para Renata, essas visitas valem mais do que qualquer relatório.',
          'A cada coleção mandamos para as lojas um catálogo com a história de cada peça e da artesã que fez.',
          'Duas vezes por ano eu viajo para visitar as maiores clientes',
          'Essas visitas valem mais do que qualquer relatório.',
        ),
        p(
          'lu-s2-p2c',
          'O preço de exportação é calculado de trás para frente, a partir do valor que a peça precisa ter na vitrine europeia; a loja costuma multiplicar por dois e meio o que paga à Lume. Com frete consolidado e laudo, a margem lá fora ficou parecida com a do Brasil, mas o pedido europeu é maior e chega com seis meses de antecedência.',
          'Partimos do preço que a peça precisa ter na vitrine europeia e fazemos a conta de trás para frente.',
          'A loja costuma multiplicar por dois e meio o que paga para nós.',
          'Com o frete consolidado e o laudo, nossa margem lá fora ficou parecida com a daqui.',
          'o pedido europeu é maior e chega com seis meses de antecedência',
        ),
        p(
          'lu-s2-p3',
          'Com a demanda crescendo mais rápido do que a capacidade artesanal, e sem planos de industrializar a produção, a marca vai abrir um quinto núcleo no ano que vem, com doze novas artesãs. “Crescer devagar faz parte do produto”, diz Renata.',
          'A demanda cresce mais rápido do que a nossa capacidade de produzir à mão, e eu não quero industrializar a Lume.',
          'Estamos abrindo um quinto núcleo no ano que vem, com doze novas artesãs.',
          'Crescer devagar faz parte do produto.',
        ),
      ],
    },
  ],
};

export const LUME_SLIDES: SlideCopy[] = [
  { layout: 'cover', slots: { kicker: 'Exportação · Lume Acessórios', title: 'Bijuteria artesanal em 64 lojas europeias' }, sourceBlockIds: ['lu-intro-1'] },
  {
    layout: 'context',
    slots: { title: 'Começou em Lisboa', body: 'Em 2021, uma loja de museu encomendou trezentas peças inspiradas em azulejos e vendeu tudo em seis semanas.' },
    sourceBlockIds: ['lu-intro-1'],
  },
  {
    layout: 'point',
    slots: { title: 'Cada peça conta quem fez', body: 'Um cartão identifica a artesã e o material. São 38 artesãs em quatro núcleos.' },
    sourceBlockIds: ['lu-s1-p1', 'lu-s1-p2'],
  },
  {
    layout: 'quote',
    slots: { quote: 'Esse cartão vende mais do que qualquer vitrine.', attribution: 'Renata Vidal, fundadora da Lume Acessórios' },
    sourceBlockIds: ['lu-q1'],
  },
  {
    layout: 'closing',
    slots: { title: 'Crescer devagar faz parte do produto', body: 'Um quinto núcleo, com doze novas artesãs, abre no ano que vem.', cta: 'Leia a matéria completa' },
    sourceBlockIds: ['lu-s2-p3'],
  },
];

export function lumeScripts(source: Source): ScriptEntry {
  return {
    sourceId: source.id,
    draft: buildDraftScript(source, LUME_ARTICLE),
    titles: [
      'Da loja de museu em Lisboa a 64 lojas: a rota europeia da Lume',
      'Lume Acessórios: o cartão que vende mais do que a vitrine',
      'Bijuteria artesanal brasileira cresce na Europa sem pressa',
    ],
    subheadings: ['Peças com nome e origem', 'Laudo, frete e novas artesãs'],
    carousel: LUME_SLIDES,
  };
}

export function lumeStory(ctx: StoryContext): Story {
  const createdAt = ago(ctx.now, { days: 3, hours: 5 });
  const source = buildTranscriptSource({
    id: 'src-lume',
    title: 'Entrevista Lume Acessórios: bijuteria na Europa',
    origin: 'interview',
    text: LUME_TRANSCRIPT,
    fileName: 'entrevista-lume.txt',
    speakers: { 'Rafael Dias': PEOPLE.rafael, 'Renata Vidal': PEOPLE.renata },
    authorized: true,
    recordedOn: dateOf(ago(ctx.now, { days: 8 })),
    createdAt,
    createdBy: PEOPLE.rafael,
  });
  const script = lumeScripts(source);
  if (!script.draft) throw new Error('lume: missing draft');
  const builder = startScenario({
    key: 'lume',
    title: 'Lume Acessórios: bijuteria brasileira na Europa',
    source,
    ownerId: PEOPLE.rafael,
    createdAt,
    brief: { angle: 'Como uma marca artesanal cresce na Europa sem perder a identidade', sections: 2, size: 'standard', revision: 1 },
    plan: ['article', 'carousel'],
    templates: ctx.templates,
  });
  const v1 = builder.generate('article', { body: scriptBody(script.draft), endedAt: after(createdAt, { minutes: 3 }), durationMs: 44_000, by: PEOPLE.rafael });
  const v2Body = reviewAll(
    applyEdits(source, v1.body as ArticleBody, [
      {
        type: 'text',
        blockId: 'lu-s1-p1',
        text: 'Segundo a fundadora Renata Vidal, o comprador europeu procura cor e história: peças que não poderiam ter sido feitas em qualquer lugar. Cada bijuteria sai com um cartão que identifica a artesã e o material usado, como sementes e metal reaproveitado.',
      },
    ]),
  );
  builder.saveEdit('article', v2Body, ago(ctx.now, { days: 2, hours: 6 }), PEOPLE.rafael);
  builder.requestReview('article', ago(ctx.now, { days: 2, hours: 5 }), PEOPLE.rafael, { assigneeId: PEOPLE.pedro });
  builder.decide('article', 'approved', ago(ctx.now, { days: 1, hours: 20 }), PEOPLE.pedro);

  builder.startCarousel(NEUTRAL_DARK_TEMPLATE_ID, ago(ctx.now, { hours: 6 }), PEOPLE.rafael);
  const carousel: CarouselBody = { type: 'carousel', templateId: NEUTRAL_DARK_TEMPLATE_ID, slides: slidesFrom('lume', LUME_SLIDES) };
  builder.generate('carousel', { body: carousel, endedAt: ago(ctx.now, { hours: 5, minutes: 50 }), durationMs: 31_000, by: PEOPLE.rafael });
  // Overdue: it was due yesterday ("atrasado · prazo era …"), no "Recado".
  builder.requestReview('carousel', ago(ctx.now, { hours: 4 }), PEOPLE.rafael, { assigneeId: PEOPLE.pedro, dueOn: localDateOf(ago(ctx.now, { days: 1 })) });
  return {
    scenario: builder.scenario,
    script,
    expect: {
      label: 'Artigo aprovado, carrossel aguardando aprovação (atrasado)',
      productionStatus: 'in_review',
      pieces: { article: 'approved', carousel: 'in_review' },
      draftQuotes: { verified: 2, total: 2 },
    },
  };
}
