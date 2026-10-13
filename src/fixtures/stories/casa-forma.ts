import type { ArticleBody, Source } from '../../domain/index.ts';
import { anchorOn, applyEdits, buildDraftScript, h2, img, p, quote, reviewAll } from '../build/article.ts';
import type { ArticleSpec } from '../build/article.ts';
import { startScenario } from '../build/scenario.ts';
import { buildTranscriptSource } from '../build/source.ts';
import { PEOPLE } from '../people.ts';
import { scriptBody } from '../script-book.ts';
import type { ScriptEntry } from '../script-book.ts';
import { after, ago, dateOf } from '../time.ts';
import type { Story, StoryContext } from './types.ts';

/**
 * State: changes requested (orange). João sent v2 for approval; Pedro returned it with a note
 * anchored to two passages. The note and anchors become the first copilot turn
 * ("Aplicar nota com IA") when João reopens the studio.
 */

export const CASA_FORMA_TRANSCRIPT = [
  'Rafael Dias: Lia, a Casa Forma fabrica móveis de design e ficou conhecida pelos estandes na feira. Quanto vocês planejam antes do evento?',
  'Lia Moraes: Começamos seis meses antes. O estande é a última etapa de um trabalho que inclui lista de convidados, agenda de reuniões e escolha das peças. Quando a feira abre, mais da metade das reuniões do primeiro dia já está marcada. O estande vende antes da feira começar.',
  'Rafael Dias: O que mudou no desenho do estande nos últimos anos?',
  'Lia Moraes: Ficou menor e mais útil. Já tivemos um estande de 300 metros quadrados com quarenta peças expostas. Hoje usamos 180 metros e mostramos dezoito peças, montadas como ambientes reais. O lojista entende melhor a peça quando vê o sofá numa sala montada, com tapete e luminária, do que enfileirado numa vitrine.',
  'Rafael Dias: E isso deu resultado?',
  'Lia Moraes: Deu. Na última edição recebemos 2.300 visitantes no estande, menos do que nos anos de estande grande, mas fechamos 35% mais pedidos. O visitante que entra hoje é mais qualificado, porque a gente convida e filtra antes. Prefiro cem lojistas certos a mil curiosos.',
  'Rafael Dias: Como vocês escolhem as dezoito peças?',
  'Lia Moraes: Pelo que o lojista vai conseguir vender, não pelo que a gente acha mais bonito. Olhamos o giro de cada peça na temporada anterior e o que os lojistas pediram nas visitas. Pelo menos um terço das peças do estande é lançamento, porque o lojista vem à feira para ver novidade. O resto são os campeões de venda com acabamentos novos.',
  'Rafael Dias: O estande ainda tem espaço para algo inesperado?',
  'Lia Moraes: Tem um canto que a gente chama de oficina. Um marceneiro trabalha ali durante a feira, mostrando o encaixe das peças e o acabamento à mão. É o lugar que mais para gente no estande e o que mais gera conversa sobre qualidade. O lojista leva essa história para a loja e conta para o cliente final.',
  'Rafael Dias: Como vocês filtram?',
  'Lia Moraes: Com o cadastro. Cruzamos a lista de credenciados da feira com a nossa carteira e com o perfil de loja que a gente quer atingir. Cada vendedor chega com uma lista de vinte nomes prioritários e sabe o histórico de cada um. Visitante sem agendamento é bem-vindo, mas o roteiro da equipe é feito para quem foi convidado.',
  'Rafael Dias: Qual é o maior erro que você vê em estandes?',
  'Lia Moraes: Tentar mostrar tudo. A empresa leva o catálogo inteiro e o visitante não consegue enxergar nada. O segundo erro é a equipe. Estande bonito com vendedor olhando o celular perde para estande simples com gente preparada. Nós fazemos um treinamento de dois dias antes de cada feira, com simulação de atendimento.',
  'Rafael Dias: E o pós-feira?',
  'Lia Moraes: É onde a maioria das empresas perde dinheiro. Todo contato do estande recebe retorno em até 48 horas, com a proposta que foi conversada. Depois de uma semana, quem não respondeu recebe uma ligação. Metade dos pedidos que atribuímos à feira é fechada nas três semanas seguintes ao evento.',
  'Rafael Dias: Quanto custa tudo isso?',
  'Lia Moraes: O estande é a parte mais visível, mas representa cerca de 40% do investimento. O resto é viagem, amostra, treinamento e a equipe dedicada ao pós-feira. Medimos o retorno por pedido fechado em até seis meses, e não por visitante. Por esse critério, a feira continua sendo nosso canal de venda mais eficiente.',
  'Rafael Dias: E depois da feira, o estande vai para onde?',
  'Lia Moraes: Boa parte vira showroom. As peças voltam para a fábrica e passam a ser usadas nas visitas de lojistas durante o ano. Os ambientes montados para a feira são fotografados e entram no catálogo da temporada. A estrutura do estande é desmontável e já foi usada em três edições seguidas, o que reduziu o custo de montagem pela metade.',
].join('\n\n');

export const CASA_FORMA_ARTICLE: ArticleSpec = {
  title: 'Casa Forma reduz estande e fecha 35% mais pedidos na feira',
  coverSlot: { subject: 'Estande da Casa Forma com as peças montadas como ambientes', suggestedCaption: 'O estande da Casa Forma na feira', suggestedAlt: 'Sala montada no estande da Casa Forma, com sofá, tapete e luminária', orientation: 'landscape' },
  keyExcerpts: [
    'O estande vende antes da feira começar.',
    'Na última edição recebemos 2.300 visitantes no estande, menos do que nos anos de estande grande, mas fechamos 35% mais pedidos.',
    'Prefiro cem lojistas certos a mil curiosos.',
    'Metade dos pedidos que atribuímos à feira é fechada nas três semanas seguintes ao evento.',
  ],
  sections: [
    {
      id: 'intro',
      blocks: [
        p(
          'cf-intro-1',
          'A Casa Forma, fabricante de móveis de design, encolheu o estande e aumentou as vendas. Na última edição da feira, a empresa recebeu 2.300 visitantes, menos do que nos anos de estande grande, mas fechou 35% mais pedidos. Para a diretora de marketing Lia Moraes, o resultado vem de um trabalho que começa seis meses antes do evento e termina semanas depois dele.',
          'a Casa Forma fabrica móveis de design',
          'Na última edição recebemos 2.300 visitantes no estande, menos do que nos anos de estande grande, mas fechamos 35% mais pedidos.',
          'Começamos seis meses antes.',
        ),
        img(
          'cf-img-1',
          { subject: 'Marceneiro mostra o encaixe das peças na oficina do estande', suggestedCaption: 'Na oficina do estande, um marceneiro mostra o encaixe e o acabamento à mão', suggestedAlt: 'Marceneiro trabalha no canto de oficina do estande', orientation: 'landscape' },
          'Um marceneiro trabalha ali durante a feira, mostrando o encaixe das peças e o acabamento à mão.',
        ),
      ],
    },
    {
      id: 'section-1',
      blocks: [
        h2('cf-h1', 'Menos peças, mais pedidos'),
        p(
          'cf-s1-p1',
          'O estande caiu de 300 para 180 metros quadrados, e as peças expostas, de quarenta para dezoito, agora montadas como ambientes reais, com tapete e luminária. “O lojista entende melhor a peça quando vê o sofá numa sala montada”, explica Lia.',
          'Já tivemos um estande de 300 metros quadrados com quarenta peças expostas.',
          'Hoje usamos 180 metros e mostramos dezoito peças, montadas como ambientes reais.',
          'O lojista entende melhor a peça quando vê o sofá numa sala montada',
        ),
        p(
          'cf-s1-p1b',
          'A escolha das peças segue o giro da temporada anterior e os pedidos feitos pelos lojistas nas visitas. Pelo menos um terço do que vai ao estande é lançamento; o restante são campeões de venda com acabamentos novos.',
          'Olhamos o giro de cada peça na temporada anterior e o que os lojistas pediram nas visitas.',
          'Pelo menos um terço das peças do estande é lançamento',
          'O resto são os campeões de venda com acabamentos novos.',
        ),
        p(
          'cf-s1-p2',
          'O público também mudou. A equipe cruza a lista de credenciados da feira com a carteira de clientes e com o perfil de loja desejado, e cada vendedor chega ao evento com vinte nomes prioritários e o histórico de cada um. Quando os portões abrem, mais da metade das reuniões do primeiro dia já está marcada. Visitantes sem agendamento são bem-vindos, mas o roteiro da equipe é pensado para os convidados.',
          'Cruzamos a lista de credenciados da feira com a nossa carteira e com o perfil de loja que a gente quer atingir.',
          'Cada vendedor chega com uma lista de vinte nomes prioritários e sabe o histórico de cada um.',
          'mais da metade das reuniões do primeiro dia já está marcada',
          'Visitante sem agendamento é bem-vindo, mas o roteiro da equipe é feito para quem foi convidado.',
        ),
        p(
          'cf-s1-p3',
          'Um canto do estande, batizado de oficina, recebe um marceneiro que trabalha durante a feira mostrando encaixes e acabamento à mão. É o ponto que mais atrai visitantes e o que mais gera conversa sobre qualidade, uma história que o lojista depois repete ao cliente final.',
          'Tem um canto que a gente chama de oficina.',
          'Um marceneiro trabalha ali durante a feira, mostrando o encaixe das peças e o acabamento à mão.',
          'É o lugar que mais para gente no estande e o que mais gera conversa sobre qualidade.',
          'O lojista leva essa história para a loja e conta para o cliente final.',
        ),
        quote('cf-q1', 'Prefiro cem lojistas certos a mil curiosos.'),
      ],
    },
    {
      id: 'section-2',
      blocks: [
        h2('cf-h2', 'O pós-feira define o resultado'),
        p(
          'cf-s2-p1',
          'Para Lia, o maior erro dos expositores é tentar mostrar tudo: com o catálogo inteiro no estande, o visitante não consegue enxergar nada. O segundo erro é a equipe. Por isso, os vendedores da Casa Forma passam por dois dias de treinamento, com simulação de atendimento, antes de cada edição.',
          'Tentar mostrar tudo.',
          'A empresa leva o catálogo inteiro e o visitante não consegue enxergar nada.',
          'Nós fazemos um treinamento de dois dias antes de cada feira, com simulação de atendimento.',
        ),
        img(
          'cf-img-2',
          { subject: 'Ambientes da feira fotografados para o catálogo da temporada', suggestedCaption: 'Os ambientes montados para a feira entram no catálogo da temporada', suggestedAlt: 'Ambiente do estande da Casa Forma fotografado para o catálogo', orientation: 'landscape' },
          'Os ambientes montados para a feira são fotografados e entram no catálogo da temporada.',
        ),
        p(
          'cf-s2-p2',
          'É nessa etapa, segundo Lia, que a maioria das empresas perde dinheiro. Depois do evento, todo contato recebe retorno em até 48 horas, com a proposta conversada no estande, e quem não responde em uma semana recebe uma ligação. Metade dos pedidos atribuídos à feira é fechada nas três semanas seguintes.',
          'É onde a maioria das empresas perde dinheiro.',
          'Todo contato do estande recebe retorno em até 48 horas',
          'Depois de uma semana, quem não respondeu recebe uma ligação.',
          'Metade dos pedidos que atribuímos à feira é fechada nas três semanas seguintes ao evento.',
        ),
        p(
          'cf-s2-p2b',
          'Depois do evento, boa parte do estande vira showroom: as peças voltam para a fábrica e passam a receber lojistas ao longo do ano, e os ambientes montados para a feira são fotografados para o catálogo da temporada. A estrutura, desmontável, já foi usada em três edições seguidas, o que reduziu o custo de montagem pela metade.',
          'Boa parte vira showroom.',
          'Os ambientes montados para a feira são fotografados e entram no catálogo da temporada.',
          'A estrutura do estande é desmontável e já foi usada em três edições seguidas, o que reduziu o custo de montagem pela metade.',
        ),
        p(
          'cf-s2-p3',
          'O estande representa cerca de 40% do investimento; o restante vai para viagem, amostras, treinamento e a equipe de pós-feira. Medido por pedidos fechados em até seis meses, o evento segue como o canal de venda mais eficiente da empresa.',
          'representa cerca de 40% do investimento',
          'Medimos o retorno por pedido fechado em até seis meses',
          'a feira continua sendo nosso canal de venda mais eficiente',
        ),
      ],
    },
  ],
};

export function casaFormaScripts(source: Source): ScriptEntry {
  return {
    sourceId: source.id,
    draft: buildDraftScript(source, CASA_FORMA_ARTICLE),
    titles: [
      'Estande menor, mais pedidos: o método da Casa Forma para a feira',
      'Casa Forma troca volume de visitantes por lojistas certos',
      'O estande que vende antes da feira começar',
    ],
    subheadings: ['Ambientes no lugar de vitrines', 'Retorno em 48 horas'],
    // "Aplicar nota com IA" on the two passages Pedro pointed at (the note's two requests).
    rewrites: {
      'cf-h2': { note: 'Metade dos pedidos fecha nas três semanas seguintes' },
      'cf-s2-p3': {
        note: 'O estande representa cerca de 40% do investimento; o restante vai para viagem, amostras, treinamento e a equipe de pós-feira. Pelo critério da própria empresa, que mede o retorno por pedido fechado em até seis meses, o evento segue como o seu canal de venda mais eficiente.',
      },
    },
  };
}

export const CASA_FORMA_REVIEW_NOTE =
  'O intertítulo promete mais do que a seção entrega: traga para o primeiro parágrafo o dado de que metade dos pedidos sai nas três semanas seguintes, ou ajuste o intertítulo. No fim, deixe claro que o critério de seis meses é da própria empresa.';

export function casaFormaStory(ctx: StoryContext): Story {
  const createdAt = ago(ctx.now, { days: 1, hours: 9 });
  const source = buildTranscriptSource({
    id: 'src-casa-forma',
    title: 'Entrevista Casa Forma: o estande que vende antes da feira',
    origin: 'interview',
    text: CASA_FORMA_TRANSCRIPT,
    fileName: 'entrevista-casa-forma.txt',
    speakers: { 'Rafael Dias': PEOPLE.rafael, 'Lia Moraes': PEOPLE.lia },
    authorized: true,
    recordedOn: dateOf(ago(ctx.now, { days: 5 })),
    createdAt,
    createdBy: PEOPLE.joao,
  });
  const script = casaFormaScripts(source);
  if (!script.draft) throw new Error('casa-forma: missing draft');
  const builder = startScenario({
    key: 'casa-forma',
    title: 'Casa Forma: o estande que vende antes da feira',
    source,
    ownerId: PEOPLE.joao,
    createdAt,
    brief: { angle: 'O método da Casa Forma para transformar a feira em pedidos', sections: 2, size: 'standard', revision: 1 },
    plan: ['article', 'carousel'],
    templates: ctx.templates,
  });
  const v1 = builder.generate('article', { body: scriptBody(script.draft), endedAt: after(createdAt, { minutes: 5 }), durationMs: 49_000, by: PEOPLE.joao });
  const v2Body = reviewAll(
    applyEdits(source, v1.body as ArticleBody, [
      {
        type: 'text',
        blockId: 'cf-intro-1',
        text: 'A Casa Forma, fabricante de móveis de design, encolheu o estande e aumentou as vendas. Na última edição da feira, recebeu 2.300 visitantes, menos do que nos anos de estande grande, mas fechou 35% mais pedidos. Para a diretora de marketing Lia Moraes, o resultado vem de um trabalho que começa seis meses antes do evento e termina semanas depois dele.',
      },
    ]),
  );
  const v2 = builder.saveEdit('article', v2Body, ago(ctx.now, { hours: 3, minutes: 30 }), PEOPLE.joao);
  builder.requestReview('article', ago(ctx.now, { hours: 3, minutes: 20 }), PEOPLE.joao, { assigneeId: PEOPLE.pedro });
  builder.decide('article', 'changes_requested', ago(ctx.now, { hours: 1, minutes: 5 }), PEOPLE.pedro, {
    note: CASA_FORMA_REVIEW_NOTE,
    anchors: [
      anchorOn(v2.body as ArticleBody, 'cf-h2'),
      anchorOn(v2.body as ArticleBody, 'cf-s2-p3', 'o evento segue como o canal de venda mais eficiente da empresa'),
    ],
  });
  return {
    scenario: builder.scenario,
    script,
    expect: {
      label: 'Ajustes solicitados com nota',
      productionStatus: 'changes_requested',
      pieces: { article: 'changes_requested', carousel: 'locked' },
      draftQuotes: { verified: 2, total: 2 },
    },
  };
}
