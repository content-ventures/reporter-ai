import type { ArticleBody, CarouselBody, Source } from '../../domain/index.ts';
import { applyEdits, buildDraftScript, h2, img, p, quote, reviewAll } from '../build/article.ts';
import type { ArticleSpec } from '../build/article.ts';
import { startScenario } from '../build/scenario.ts';
import { buildTranscriptSource } from '../build/source.ts';
import { PEOPLE } from '../people.ts';
import { scriptBody } from '../script-book.ts';
import type { ScriptEntry, SlideCopy } from '../script-book.ts';
import { NEUTRAL_LIGHT_TEMPLATE_ID } from '../templates/provisional.ts';
import { after, ago, dateOf } from '../time.ts';
import { slidesFrom } from './slides.ts';
import type { Story, StoryContext } from './types.ts';

/**
 * State: carousel outdated (amber). The carousel was made from article v2 and approved; later
 * the article was corrected and v3 approved, so the carousel is "Desatualizado" and the export
 * offers "Exportar com artigo v2" or "Atualizar carrossel". Then Juliana edited the approved
 * text (no new version): the article reads "Aprovação desatualizada" while the carousel and the
 * delivery keep using v3. Nothing is ever deleted.
 */

export const PATIO_COURO_TRANSCRIPT = [
  'Juliana Prates: Caio, a Pátio Couro começou a reaproveitar aparas de couro. Como surgiu a ideia?',
  'Caio Nogueira: Surgiu de uma conta. A Pátio Couro é um curtume, e as fábricas que compram nosso couro descartam aparas no corte. Fizemos um levantamento com doze clientes e descobrimos que juntos eles jogavam fora cerca de 40 toneladas de aparas por ano. Era couro bom, só que em pedaços pequenos demais para um sapato.',
  'Juliana Prates: E o que vocês fazem com essas aparas?',
  'Caio Nogueira: Recolhemos nos clientes, separamos por cor e espessura e transformamos em duas coisas. As peças maiores viram matéria-prima para acessórios, como chaveiros, porta-cartões e alças de bolsa. As menores são trituradas e prensadas num laminado de couro reconstituído, que pode ser usado em palmilha e forro.',
  'Juliana Prates: Isso já é um negócio ou ainda é um projeto?',
  'Caio Nogueira: Já é um negócio pequeno. No último ano, recolhemos 11 toneladas de aparas, um quarto do que foi descartado pelos clientes do levantamento. A linha de laminado já representa 4% do faturamento da Pátio Couro. Não é muito, mas cresce todo trimestre e paga a própria operação.',
  'Juliana Prates: Como os clientes reagiram?',
  'Caio Nogueira: Gostaram, porque resolvemos um problema deles. Antes eles pagavam para descartar as aparas. Agora a gente recolhe sem custo e devolve um certificado com o peso reaproveitado, que eles usam nos relatórios de sustentabilidade. Para algumas fábricas, esse certificado virou argumento de venda com compradores de fora.',
  'Juliana Prates: Qual foi a maior dificuldade?',
  'Caio Nogueira: A logística reversa. Recolher aparas de muitas fábricas pequenas é caro. No começo mandávamos um caminhão para cada cliente e perdíamos dinheiro em toda viagem. Hoje o caminhão que entrega couro volta com as aparas. Essa mudança simples tornou o projeto viável.',
  'Juliana Prates: E a qualidade do laminado?',
  'Caio Nogueira: Foi um aprendizado. O primeiro lote rachava depois de poucas semanas de uso. Levamos quase um ano ajustando a proporção de fibras e o tipo de ligante. Hoje o laminado passa nos mesmos testes de flexão que exigimos de um forro convencional. A gente só vendeu o primeiro metro quando ele passou no teste.',
  'Juliana Prates: Quem compra os acessórios feitos com as aparas?',
  'Caio Nogueira: Principalmente marcas que querem um brinde ou uma linha pequena com história. Uma rede de lojas encomendou cinco mil chaveiros para dar aos clientes no fim do ano, cada um com a indicação de que foi feito com couro que iria para o lixo. Esse tipo de pedido ajuda a escoar as aparas de cores menos procuradas.',
  'Juliana Prates: A equipe precisou mudar?',
  'Caio Nogueira: Precisou. Criamos uma célula de seis pessoas só para separar e classificar as aparas. São pessoas que antes trabalhavam no acabamento e conhecem o couro pelo toque. A separação é manual e é ela que garante a qualidade do que sai daqui.',
  'Juliana Prates: Quanto custou começar?',
  'Caio Nogueira: O investimento inicial foi numa prensa usada e na adaptação de um galpão que estava parado. O que mais pesou não foi a máquina, foi o tempo da equipe testando receita de laminado. Se eu fosse começar de novo, começaria pelos acessórios, que dão retorno mais rápido, e só depois iria para o laminado.',
  'Juliana Prates: O que vem pela frente?',
  'Caio Nogueira: Queremos dobrar o volume recolhido nos próximos dois anos e chegar a 22 toneladas. Para isso, estamos conversando com outros curtumes da região para dividir a coleta. Aparas de couro não deveriam ser lixo em lugar nenhum.',
  'Juliana Prates: Como vocês provam para as marcas de onde vem a apara?',
  'Caio Nogueira: Cada lote recolhido recebe um número e uma ficha com a fábrica de origem, a data e o peso. Esse número acompanha o material até o produto final. Quando uma marca encomenda chaveiros, ela recebe a lista dos lotes usados. Três marcas já usam essa informação na etiqueta, e uma delas colocou um código para o consumidor consultar a origem.',
].join('\n\n');

export const PATIO_COURO_ARTICLE: ArticleSpec = {
  title: 'Pátio Couro transforma aparas descartadas em nova linha de produtos',
  coverSlot: { subject: 'Aparas de couro separadas por cor e espessura', suggestedCaption: 'Aparas recolhidas nos clientes da Pátio Couro', suggestedAlt: 'Aparas de couro separadas por cor', orientation: 'landscape' },
  keyExcerpts: [
    'cerca de 40 toneladas de aparas por ano',
    'A linha de laminado já representa 4% do faturamento da Pátio Couro.',
    'Aparas de couro não deveriam ser lixo em lugar nenhum.',
  ],
  sections: [
    {
      id: 'intro',
      blocks: [
        p(
          'pc-intro-1',
          'Um levantamento com doze clientes mostrou à Pátio Couro um desperdício que ninguém media: as fábricas que compram o couro do curtume descartavam juntas cerca de 40 toneladas de aparas por ano. O material era bom, mas pequeno demais para um sapato. Hoje essas aparas viram acessórios e um laminado de couro reconstituído, e a operação já se paga.',
          'Fizemos um levantamento com doze clientes',
          'cerca de 40 toneladas de aparas por ano',
          'Era couro bom, só que em pedaços pequenos demais para um sapato.',
        ),
        img(
          'pc-img-1',
          { subject: 'Chaveiros, porta-cartões e alças de bolsa feitos com as aparas', suggestedCaption: 'As aparas maiores viram acessórios; as menores, laminado de couro reconstituído', suggestedAlt: 'Acessórios de couro feitos com aparas reaproveitadas', orientation: 'landscape' },
          'As peças maiores viram matéria-prima para acessórios, como chaveiros, porta-cartões e alças de bolsa.',
        ),
      ],
    },
    {
      id: 'section-1',
      blocks: [
        h2('pc-h1', 'Do descarte ao faturamento'),
        p(
          'pc-s1-p1',
          'As aparas são recolhidas nos clientes e separadas por cor e espessura. As peças maiores viram chaveiros, porta-cartões e alças de bolsa; as menores são trituradas e prensadas num laminado usado em palmilhas e forros.',
          'separamos por cor e espessura',
          'As peças maiores viram matéria-prima para acessórios, como chaveiros, porta-cartões e alças de bolsa.',
          'As menores são trituradas e prensadas num laminado de couro reconstituído',
        ),
        p(
          'pc-s1-p2',
          'No último ano, o curtume recolheu 11 toneladas, um quarto do volume descartado pelos clientes do levantamento. Segundo o gerente de sustentabilidade Caio Nogueira, a linha de laminado já representa 4% do faturamento, cresce a cada trimestre e paga a própria operação.',
          'No último ano, recolhemos 11 toneladas de aparas, um quarto do que foi descartado pelos clientes do levantamento.',
          'A linha de laminado já representa 4% do faturamento da Pátio Couro.',
          'cresce todo trimestre e paga a própria operação',
        ),
        p(
          'pc-s1-p3',
          'Os acessórios atendem sobretudo marcas que buscam brindes ou linhas pequenas com história. Uma rede de lojas encomendou cinco mil chaveiros para presentear clientes no fim do ano, cada um identificado como feito de couro que iria para o lixo. Pedidos assim ajudam a escoar aparas de cores menos procuradas.',
          'Principalmente marcas que querem um brinde ou uma linha pequena com história.',
          'Uma rede de lojas encomendou cinco mil chaveiros',
          'Esse tipo de pedido ajuda a escoar as aparas de cores menos procuradas.',
        ),
        quote('pc-q1', 'Aparas de couro não deveriam ser lixo em lugar nenhum.'),
      ],
    },
    {
      id: 'section-2',
      blocks: [
        h2('pc-h2', 'Logística e qualidade'),
        p(
          'pc-s2-p1',
          'Para os clientes, a coleta sem custo resolveu um problema: antes eles pagavam para descartar as aparas. Agora recebem um certificado com o peso reaproveitado, que entra nos relatórios de sustentabilidade e virou argumento de venda de algumas fábricas com compradores estrangeiros.',
          'Antes eles pagavam para descartar as aparas.',
          'devolve um certificado com o peso reaproveitado',
          'esse certificado virou argumento de venda com compradores de fora',
        ),
        img(
          'pc-img-2',
          { subject: 'Caminhão que entrega couro e volta com as aparas', suggestedCaption: 'O caminhão que entrega couro volta com as aparas', suggestedAlt: 'Caminhão da Pátio Couro carregado com sacos de aparas', orientation: 'landscape' },
          'Hoje o caminhão que entrega couro volta com as aparas.',
        ),
        p(
          'pc-s2-p2',
          'A viabilidade veio de uma mudança simples na logística reversa. No começo, um caminhão ia a cada cliente, e o curtume perdia dinheiro em toda viagem; hoje o caminhão que entrega couro volta com as aparas. O primeiro lote de laminado rachava depois de poucas semanas de uso, e a qualidade levou quase um ano de ajustes até o laminado passar nos mesmos testes de flexão de um forro convencional. “A gente só vendeu o primeiro metro quando ele passou no teste”, conta Caio.',
          'No começo mandávamos um caminhão para cada cliente e perdíamos dinheiro em toda viagem.',
          'Hoje o caminhão que entrega couro volta com as aparas.',
          'O primeiro lote rachava depois de poucas semanas de uso.',
          'Levamos quase um ano ajustando a proporção de fibras e o tipo de ligante.',
          'A gente só vendeu o primeiro metro quando ele passou no teste.',
        ),
        p(
          'pc-s2-p2b',
          'O investimento inicial se resumiu a uma prensa usada e à adaptação de um galpão parado; o que mais pesou foi o tempo da equipe testando receitas de laminado. Se recomeçasse, Caio iria primeiro aos acessórios, que dão retorno mais rápido, e só depois ao laminado.',
          'O investimento inicial foi numa prensa usada e na adaptação de um galpão que estava parado.',
          'O que mais pesou não foi a máquina, foi o tempo da equipe testando receita de laminado.',
          'Se eu fosse começar de novo, começaria pelos acessórios, que dão retorno mais rápido',
        ),
        p(
          'pc-s2-p2c',
          'Cada lote recolhido recebe um número e uma ficha com a fábrica de origem, a data e o peso, e esse registro acompanha o material até o produto final. As marcas que encomendam acessórios recebem a lista dos lotes usados; três delas já levam a informação para a etiqueta, e uma incluiu um código para o consumidor consultar a origem.',
          'Cada lote recolhido recebe um número e uma ficha com a fábrica de origem, a data e o peso.',
          'Esse número acompanha o material até o produto final.',
          'Três marcas já usam essa informação na etiqueta',
          'uma delas colocou um código para o consumidor consultar a origem',
        ),
        p(
          'pc-s2-p3',
          'A separação é manual, feita por uma célula de seis pessoas vindas do acabamento, que reconhecem o couro pelo toque. A meta é dobrar o volume recolhido em dois anos, chegando a 22 toneladas, com uma coleta dividida entre curtumes da região.',
          'Criamos uma célula de seis pessoas só para separar e classificar as aparas.',
          'conhecem o couro pelo toque',
          'Queremos dobrar o volume recolhido nos próximos dois anos e chegar a 22 toneladas.',
        ),
      ],
    },
  ],
};

export const PATIO_COURO_SLIDES: SlideCopy[] = [
  { layout: 'cover', slots: { kicker: 'Sustentabilidade · Pátio Couro', title: 'Aparas de couro viram nova linha de produtos' }, sourceBlockIds: ['pc-intro-1'] },
  {
    layout: 'context',
    slots: { title: '40 toneladas por ano', body: 'Era o volume de aparas descartado por doze clientes do curtume. Couro bom, mas pequeno demais para um sapato.' },
    sourceBlockIds: ['pc-intro-1'],
  },
  {
    layout: 'point',
    slots: { title: 'Acessórios e laminado', body: 'As peças maiores viram chaveiros e alças. As menores, um laminado para palmilhas e forros.' },
    sourceBlockIds: ['pc-s1-p1'],
  },
  {
    layout: 'quote',
    slots: { quote: 'Aparas de couro não deveriam ser lixo em lugar nenhum.', attribution: 'Caio Nogueira, Pátio Couro' },
    sourceBlockIds: ['pc-q1'],
  },
  {
    layout: 'closing',
    slots: { title: 'Meta: 22 toneladas', body: 'O curtume quer dobrar o volume recolhido em dois anos, com coleta dividida na região.', cta: 'Leia a matéria completa' },
    sourceBlockIds: ['pc-s2-p3'],
  },
];

export function patioCouroScripts(source: Source): ScriptEntry {
  return {
    sourceId: source.id,
    draft: buildDraftScript(source, PATIO_COURO_ARTICLE),
    titles: [
      'Curtume recolhe 11 toneladas de aparas e cria linha de laminado',
      'Pátio Couro: o couro que voltaria para o lixo vira produto',
      'Aparas de couro deixam de ser descarte na Pátio Couro',
    ],
    subheadings: ['Do corte à nova linha', 'Coleta no caminhão de entrega'],
    carousel: PATIO_COURO_SLIDES,
  };
}

export function patioCouroStory(ctx: StoryContext): Story {
  const createdAt = ago(ctx.now, { days: 9, hours: 4 });
  const source = buildTranscriptSource({
    id: 'src-patio-couro',
    title: 'Entrevista Pátio Couro: aparas viram produto',
    origin: 'interview',
    text: PATIO_COURO_TRANSCRIPT,
    fileName: 'entrevista-patio-couro.txt',
    speakers: { 'Juliana Prates': PEOPLE.juliana, 'Caio Nogueira': PEOPLE.caio },
    authorized: true,
    recordedOn: dateOf(ago(ctx.now, { days: 12 })),
    createdAt,
    createdBy: PEOPLE.juliana,
  });
  const script = patioCouroScripts(source);
  if (!script.draft) throw new Error('patio-couro: missing draft');
  const builder = startScenario({
    key: 'patio-couro',
    title: 'Pátio Couro: aparas viram produto',
    source,
    ownerId: PEOPLE.juliana,
    createdAt,
    brief: { angle: 'Como um curtume transformou descarte em linha de produtos', sections: 2, size: 'standard', revision: 1 },
    plan: ['article', 'carousel'],
    templates: ctx.templates,
  });
  const v1 = builder.generate('article', { body: scriptBody(script.draft), endedAt: after(createdAt, { minutes: 4 }), durationMs: 50_000, by: PEOPLE.juliana });
  const v2Body = reviewAll(v1.body as ArticleBody);
  builder.saveEdit('article', v2Body, ago(ctx.now, { days: 8, hours: 2 }), PEOPLE.juliana);
  builder.requestReview('article', ago(ctx.now, { days: 8, hours: 1 }), PEOPLE.juliana, { assigneeId: PEOPLE.pedro });
  builder.decide('article', 'approved', ago(ctx.now, { days: 7, hours: 3 }), PEOPLE.pedro);

  builder.startCarousel(NEUTRAL_LIGHT_TEMPLATE_ID, ago(ctx.now, { days: 6, hours: 6 }), PEOPLE.juliana);
  const carousel: CarouselBody = { type: 'carousel', templateId: NEUTRAL_LIGHT_TEMPLATE_ID, slides: slidesFrom('patio-couro', PATIO_COURO_SLIDES) };
  builder.generate('carousel', { body: carousel, endedAt: ago(ctx.now, { days: 6, hours: 5 }), durationMs: 29_000, by: PEOPLE.juliana });
  builder.requestReview('carousel', ago(ctx.now, { days: 6, hours: 2 }), PEOPLE.juliana, { assigneeId: PEOPLE.pedro });
  builder.decide('carousel', 'approved', ago(ctx.now, { days: 5, hours: 22 }), PEOPLE.pedro);

  // Caio asked for a correction after publication planning: the article gets v3, re-approved.
  const v3Body = applyEdits(source, v2Body, [
    {
      type: 'text',
      blockId: 'pc-s2-p3',
      text: 'A separação é manual, feita por uma célula de seis pessoas vindas do acabamento, que reconhecem o couro pelo toque. A meta é dobrar o volume recolhido nos próximos dois anos, chegando a 22 toneladas. Para isso, o curtume já conversa com outros curtumes da região para dividir a coleta.',
    },
  ]);
  builder.saveEdit('article', v3Body, ago(ctx.now, { hours: 6 }), PEOPLE.juliana);
  builder.requestReview('article', ago(ctx.now, { hours: 5, minutes: 40 }), PEOPLE.juliana, {
    assigneeId: PEOPLE.pedro,
    note: 'Correção pedida pelo Caio: a coleta compartilhada ainda está em conversa.',
  });
  builder.decide('article', 'approved', ago(ctx.now, { hours: 3 }), PEOPLE.pedro);
  // Juliana touched the approved text afterwards (autosave, no new version): "Aprovação
  // desatualizada". Carousel and delivery keep using the approved v3.
  builder.editDraft(
    'article',
    applyEdits(source, v3Body, [
      {
        type: 'text',
        blockId: 'pc-s2-p2b',
        text: 'O investimento inicial se resumiu a uma prensa usada e à adaptação de um galpão parado. O que mais pesou foi o tempo da equipe testando receitas de laminado. Se recomeçasse, Caio iria primeiro aos acessórios, que dão retorno mais rápido, e só depois ao laminado.',
      },
    ]),
    ago(ctx.now, { hours: 1 }),
    PEOPLE.juliana,
  );
  return {
    scenario: builder.scenario,
    script,
    expect: {
      label: 'Aprovação desatualizada (artigo editado depois de aprovado) e carrossel desatualizado',
      productionStatus: 'stale',
      pieces: { article: 'approval_outdated', carousel: 'stale' },
      draftQuotes: { verified: 2, total: 2 },
    },
  };
}
