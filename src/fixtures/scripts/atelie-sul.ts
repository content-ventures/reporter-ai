import type { Source } from '../../domain/index.ts';
import { buildDraftScript, h2, p, quote } from '../build/article.ts';
import type { ArticleSpec } from '../build/article.ts';
import type { ScriptEntry } from '../script-book.ts';

/**
 * Hand-written outputs for the flagship interview: article v1 (≈850 words, intro + 3 sections,
 * 6 quotations that match the transcript exactly), rewrites per tone for three paragraphs,
 * alternative titles, heading ideas and five slides. Every fact comes from the transcript.
 */

export const ATELIE_SUL_ARTICLE: ArticleSpec = {
  title: 'Da garagem à exportação: como o Ateliê Sul usa rastreabilidade e IA sem perder o ofício',
  keyExcerpts: [
    'Foi numa garagem, em 2015, com duas máquinas de costura usadas e muita teimosia.',
    'A feira mudou tudo, porque ali a gente entendeu que o produto aguentava a comparação com qualquer marca do pavilhão.',
    'O lucro da fábrica tem que vir da fábrica.',
    'A rastreabilidade deixou de ser diferencial e virou passaporte.',
    'Sustentabilidade que estraga o sapato não se sustenta.',
    'A IA não desenha sapato, ela encurta a conversa até o sapato certo.',
    'A IA é tão boa quanto a memória da empresa.',
  ],
  sections: [
    {
      id: 'intro',
      blocks: [
        p(
          'as-intro-1',
          'O Ateliê Sul começou em 2015 numa garagem, com duas máquinas de costura usadas. Hoje, a fábrica de calçados femininos de couro emprega 142 pessoas, produz em média 1.100 pares por dia e vende para onze países, que respondem por 38% do faturamento. Em entrevista à Content Ventures, a fundadora Marina Lopes e o consultor de comércio exterior Tiago Rezende explicam como a empresa transformou exportação, rastreabilidade do couro e inteligência artificial em método, e não em aposta.',
          'Foi numa garagem, em 2015, com duas máquinas de costura usadas e muita teimosia.',
          'com 142 pessoas trabalhando aqui dentro e uma produção média de 1.100 pares por dia',
          'Hoje são 38% do faturamento, para onze países.',
        ),
        p(
          'as-intro-2',
          'A trajetória mostra que disciplina pesa mais do que tamanho. A empresa testou cada passo antes de crescer e, nas palavras de Marina, nunca avançou além do que conseguia sustentar.',
          'nunca deu um passo maior do que conseguia sustentar',
        ),
      ],
    },
    {
      id: 'section-1',
      blocks: [
        h2('as-h1', 'Do acaso ao método na exportação'),
        p(
          'as-s1-p1',
          'O primeiro pedido internacional veio por acaso. Em 2017, num estande pequeno no fundo do pavilhão de uma feira, uma compradora de uma rede chilena pediu 600 pares para entrega em noventa dias. A fábrica entregou com quatro dias de atraso, contratou seis costureiras e aprendeu na prática a lidar com fatura comercial e certificado de origem. O pedido pagou a primeira esteira.',
          'Em 2017 a gente juntou dinheiro e alugou o menor estande que existia',
          'perguntou se a gente conseguia entregar 600 pares em noventa dias',
          'Conseguimos, com quatro dias de atraso e muita madrugada.',
          'Esse pedido do Chile pagou a primeira esteira.',
        ),
        quote('as-q1', 'A feira mudou tudo, porque ali a gente entendeu que o produto aguentava a comparação com qualquer marca do pavilhão.'),
        p(
          'as-s1-p2',
          'Para Tiago Rezende, que acompanha a exportação de calçados há cerca de 18 anos, o mérito foi não ficar refém da sorte. Ele resume o método em três frentes: conhecer o custo real de cada par exportado, escolher mercados em vez de aceitar qualquer pedido e ter alguém na empresa dedicado ao tema. A regra vale também para o câmbio. “O lucro da fábrica tem que vir da fábrica”, diz o consultor, que recomenda travar parte dos contratos assim que o pedido é confirmado.',
          'Há uns dezoito anos, Clara.',
          'Significa três coisas bem práticas.',
          'O lucro da fábrica tem que vir da fábrica.',
          'travar uma parte dos contratos assim que o pedido é confirmado',
        ),
        p(
          'as-s1-p3',
          'A diversificação virou regra depois de alguns sustos. O Chile, que já respondeu por quase metade das vendas externas, hoje divide espaço com Portugal, Uruguai, Estados Unidos e Colômbia, e nenhum país pode passar de 15% do faturamento total. Os erros também ensinaram: um lote enviado a Lisboa com etiqueta de composição só em português do Brasil ficou onze dias parado na alfândega. Desde então, cada embarque passa por um checklist por país, conferido por duas pessoas.',
          'nenhum país pode passar de 15% do faturamento total',
          'o lote ficou parado na alfândega por onze dias',
          'ninguém embarca nada sem duas pessoas conferirem',
        ),
      ],
    },
    {
      id: 'section-2',
      blocks: [
        h2('as-h2', 'Rastreabilidade virou passaporte'),
        p(
          'as-s2-p1',
          'A sustentabilidade deixou de ser pergunta de cortesia. Compradores europeus enviam questionários de quarenta perguntas antes mesmo de pedir amostra e exigem documentos sobre a origem do couro, o curtume e o tratamento da água. Hoje, 70% do couro que entra no Ateliê Sul é rastreado até o frigorífico, e a meta é chegar a 100% até o fim do ano que vem. Cada lote recebe um código que acompanha corte, costura e montagem até a caixa.',
          'Hoje vem um questionário de quarenta perguntas antes mesmo de pedirem amostra.',
          'Hoje 70% do couro que entra aqui é rastreado até o frigorífico',
          'Cada lote de couro chega com um código',
        ),
        p(
          'as-s2-p2',
          '“A rastreabilidade deixou de ser diferencial e virou passaporte”, afirma Tiago. Segundo ele, quem não consegue provar a origem do material fica fora da lista de fornecedores. O custo de implantação assusta no início, mas cai depois do primeiro ano, e a fábrica passa a conhecer a própria cadeia. Para Marina, o processo também obrigou a empresa a organizar o que vinha sendo adiado.',
          'A rastreabilidade deixou de ser diferencial e virou passaporte.',
          'Quem não consegue provar a origem do couro simplesmente não entra na lista.',
          'ela passa a conhecer a própria cadeia',
          'A rastreabilidade me obrigou a organizar coisas que eu deixava para depois.',
        ),
        p(
          'as-s2-p3',
          'No Ateliê Sul, o controle revelou desperdício: a perda de couro no corte, que chegava a quase 9% por causa de moldes mal encaixados, caiu para 5,5%. O solado passou a levar 30% de borracha reciclada, aprovado só depois de oito meses de testes de flexão e abrasão. Marina é direta sobre o critério: “Sustentabilidade que estraga o sapato não se sustenta.”',
          'perdia quase 9% do couro no corte por causa de molde mal encaixado',
          'Hoje essa perda está em 5,5%',
          'Nosso solado de borracha hoje tem 30% de borracha reciclada',
          'Sustentabilidade que estraga o sapato não se sustenta.',
        ),
      ],
    },
    {
      id: 'section-3',
      blocks: [
        h2('as-h3', 'A IA propõe, a equipe decide'),
        p(
          'as-s3-p1',
          'A inteligência artificial chegou para resolver um problema medido. Cada modelo levava em média 21 dias do primeiro desenho à amostra aprovada e passava por seis amostras físicas. Hoje, a ferramenta gera variações de desenhos da própria equipe, cruza as propostas com o histórico de vendas e devoluções e alimenta amostras virtuais em 3D para os representantes. O desenvolvimento caiu para 9 dias por modelo, e as amostras físicas, para duas.',
          'Do primeiro desenho até a amostra aprovada eram em média 21 dias por modelo',
          'O tempo médio de desenvolvimento caiu de 21 para 9 dias por modelo.',
          'o número de amostras físicas caiu de seis para duas',
        ),
        quote('as-q2', 'A IA não desenha sapato, ela encurta a conversa até o sapato certo.'),
        p(
          'as-s3-p2',
          'A decisão continua humana. Marina lembra de uma bota sugerida pelo sistema com um salto esculpido impossível de montar, que divertiu a modelagem por uma semana. Para Tiago, o caso funciona porque começou de um problema medido, e não de uma ferramenta da moda. Antes de adotar qualquer sistema, a empresa passou seis meses organizando fichas técnicas e históricos de devolução. “A IA é tão boa quanto a memória da empresa”, diz o consultor.',
          'uma bota que o sistema sugeriu com um salto lindo',
          'O caso do Ateliê Sul funciona porque começou de um problema medido',
          'A gente passou seis meses só organizando dados antes de usar qualquer ferramenta.',
          'A IA é tão boa quanto a memória da empresa.',
        ),
        p(
          'as-s3-p3',
          'O próximo desafio é de gente. A idade média das costureiras é de 51 anos, e a fábrica vai abrir no ano que vem uma escola de ofício interna, com turmas de vinte jovens, bolsa e contratação garantida. A primeira turma começa em março e já tem mais de setenta inscritos para vinte vagas. Nenhum posto foi cortado por causa da tecnologia: um ano depois da amostra virtual, o Ateliê Sul contratou 22 pessoas. A meta para os próximos três anos é chegar a 1.500 pares por dia, com metade do faturamento vindo de fora.',
          'A idade média das nossas costureiras é de 51 anos.',
          'uma escola de ofício aqui dentro, com turmas de vinte jovens',
          'já temos mais de setenta inscritos para vinte vagas',
          'Ninguém foi demitido por causa da tecnologia.',
          'Quero chegar a 1.500 pares por dia sem perder o jeito de ateliê',
        ),
      ],
    },
  ],
};

export function atelieSulScripts(source: Source): ScriptEntry {
  return {
    sourceId: source.id,
    draft: buildDraftScript(source, ATELIE_SUL_ARTICLE),
    rewrites: {
      'as-intro-1': {
        direct:
          'Da garagem com duas máquinas usadas, em 2015, à fábrica de 142 pessoas que produz 1.100 pares por dia e vende para onze países: esse é o Ateliê Sul. A exportação já responde por 38% do faturamento. A fundadora Marina Lopes e o consultor Tiago Rezende contam como a empresa fez de exportação, rastreabilidade e IA um método.',
        didactic:
          'O Ateliê Sul é uma fábrica de calçados femininos de couro que nasceu em 2015, numa garagem, com duas máquinas de costura usadas. Para ter uma ideia do crescimento: hoje são 142 pessoas, cerca de 1.100 pares por dia e vendas para onze países, que somam 38% do faturamento. Nesta entrevista, a fundadora Marina Lopes e o consultor Tiago Rezende explicam, passo a passo, como exportação, rastreabilidade do couro e inteligência artificial deixaram de ser apostas e viraram método.',
        formal:
          'Fundado em 2015 em uma garagem, com duas máquinas de costura usadas, o Ateliê Sul tornou-se uma fábrica de calçados femininos de couro com 142 colaboradores e produção média de 1.100 pares diários. A empresa exporta para onze países, mercado que representa 38% de seu faturamento. Em entrevista à Content Ventures, a fundadora Marina Lopes e o consultor de comércio exterior Tiago Rezende detalham como a companhia converteu exportação, rastreabilidade do couro e inteligência artificial em método de gestão.',
        shorter:
          'Nascido numa garagem em 2015, o Ateliê Sul tem hoje 142 pessoas, produz 1.100 pares por dia e exporta para onze países, que somam 38% do faturamento. Marina Lopes e Tiago Rezende explicam como exportação, rastreabilidade e IA viraram método.',
      },
      'as-s2-p1': {
        direct:
          'Sustentabilidade virou exigência. Compradores europeus mandam questionários de quarenta perguntas antes de pedir amostra e querem documento sobre couro, curtume e água. O Ateliê Sul já rastreia 70% do couro até o frigorífico e quer chegar a 100% até o fim do ano que vem. Cada lote ganha um código que vai do corte à caixa.',
        didactic:
          'Há poucos anos, perguntar sobre sustentabilidade era quase cortesia. Agora, antes mesmo de pedir amostra, compradores europeus enviam questionários com quarenta perguntas e pedem comprovação: de onde vem o couro, qual curtume o processou e se a água é tratada. Para responder, o Ateliê Sul passou a rastrear o couro até o frigorífico. Hoje isso vale para 70% do material, e a meta é 100% até o fim do ano que vem. Funciona assim: cada lote recebe um código que o acompanha no corte, na costura, na montagem e até na caixa.',
        formal:
          'A sustentabilidade deixou de ser tema protocolar nas negociações. Compradores europeus encaminham questionários de quarenta perguntas antes mesmo da solicitação de amostras e exigem documentação sobre a origem do couro, o curtume responsável e o tratamento da água. Atualmente, 70% do couro utilizado pelo Ateliê Sul é rastreado até o frigorífico, e a meta é atingir 100% até o fim do próximo ano. Cada lote recebe um código que o acompanha do corte à embalagem.',
        shorter:
          'Compradores europeus agora exigem documentos sobre couro, curtume e água antes de pedir amostra. O Ateliê Sul rastreia 70% do couro até o frigorífico e mira 100% até o fim do ano que vem.',
      },
      'as-s3-p1': {
        direct:
          'A IA entrou para resolver um problema medido: 21 dias e seis amostras físicas por modelo. Ela gera variações dos desenhos da equipe, cruza propostas com vendas e devoluções e alimenta amostras em 3D para os representantes. Resultado: 9 dias por modelo e duas amostras físicas.',
        didactic:
          'Antes da inteligência artificial, cada modelo do Ateliê Sul levava em média 21 dias do primeiro desenho à amostra aprovada e exigia seis amostras físicas, cada uma com custo de couro, mão de obra e frete. A ferramenta passou a ajudar em três frentes: cria variações dos desenhos da própria equipe, compara as propostas com o histórico de vendas e devoluções e gera amostras virtuais em 3D para os representantes mostrarem aos lojistas. Com isso, o desenvolvimento caiu para 9 dias por modelo, e as amostras físicas, para duas.',
        formal:
          'A adoção da inteligência artificial respondeu a um problema previamente mensurado: cada modelo demandava, em média, 21 dias entre o primeiro desenho e a amostra aprovada, além de seis amostras físicas. A ferramenta passou a gerar variações de desenhos da equipe, a confrontar as propostas com o histórico de vendas e devoluções e a produzir amostras virtuais em 3D destinadas aos representantes. O prazo de desenvolvimento foi reduzido para 9 dias por modelo, e o número de amostras físicas, para duas.',
        shorter: 'Com IA, o desenvolvimento de cada modelo caiu de 21 para 9 dias, e as amostras físicas, de seis para duas.',
      },
    },
    titles: [
      'Ateliê Sul: a fábrica que transformou exportação em método',
      'Rastreabilidade, IA e ofício: as lições do Ateliê Sul para quem quer exportar',
      'De duas máquinas a onze países: o que o Ateliê Sul ensina sobre crescer com cuidado',
    ],
    subheadings: ['Exportar por método, não por sorte', 'Couro com origem comprovada', 'Tecnologia que encurta o caminho'],
    carousel: [
      {
        layout: 'cover',
        slots: { kicker: 'Entrevista · Ateliê Sul', title: 'Da garagem a onze países sem perder o ofício' },
        sourceBlockIds: ['as-intro-1'],
      },
      {
        layout: 'context',
        slots: {
          title: 'O ponto de partida',
          body: 'Em 2015, duas máquinas usadas numa garagem. Hoje, 142 pessoas, 1.100 pares por dia e 38% do faturamento vindo da exportação.',
        },
        sourceBlockIds: ['as-intro-1'],
      },
      {
        layout: 'point',
        slots: {
          title: 'Rastreabilidade é passaporte',
          body: '70% do couro já é rastreado até o frigorífico. Sem provar a origem, o fornecedor fica fora da lista dos compradores europeus.',
        },
        sourceBlockIds: ['as-s2-p1', 'as-s2-p2'],
      },
      {
        layout: 'quote',
        slots: {
          quote: 'A IA não desenha sapato, ela encurta a conversa até o sapato certo.',
          attribution: 'Marina Lopes, fundadora do Ateliê Sul',
        },
        sourceBlockIds: ['as-q2'],
      },
      {
        layout: 'closing',
        slots: {
          title: '21 dias viraram 9',
          body: 'Com IA, o desenvolvimento por modelo ficou mais curto e as amostras físicas caíram de seis para duas.',
          cta: 'Leia a entrevista completa',
        },
        sourceBlockIds: ['as-s3-p1'],
      },
    ],
  };
}
