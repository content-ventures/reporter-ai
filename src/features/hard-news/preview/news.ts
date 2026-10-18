import type { DeskGoal, EditorialMap, NewsFeed, NewsItem, WritingGuide } from '@/domain/hard-news';
import { ARRIVAL_READINGS, baseArrivalId } from './arrivals.ts';

/**
 * Preview data of the R2 news desk (fictional outlets, people and figures). The backend replaces
 * it with the RSS ingestion, the AI triage and the saved settings; the screens stay the same.
 */

export type Clock = { ago: (minutes: number) => string };

export function clockAt(now: number): Clock {
  return { ago: (minutes) => new Date(now - minutes * 60_000).toISOString() };
}

export const FLAGSHIP_NEWS_ID = 'news-tilapia-exports';
export const RESEARCH_NEWS_ID = 'news-itajai-reefer';
export const ARTICLE_NEWS_ID = 'news-credit-line';

export function seedFeeds(clock: Clock): NewsFeed[] {
  return [
    { id: 'feed-observatorio', name: 'Observatório do Pescado', url: 'https://observatoriodopescado.exemplo/rss', everyMinutes: 30, state: 'active', lastReadAt: clock.ago(6), lastDay: 14, lastWeek: [11, 13, 9, 15, 12, 16, 14] },
    { id: 'feed-litoral', name: 'Agência Litoral', url: 'https://agencialitoral.exemplo/feed', everyMinutes: 15, state: 'active', lastReadAt: clock.ago(3), lastDay: 31, lastWeek: [27, 30, 24, 33, 29, 35, 31] },
    { id: 'feed-aquicola', name: 'Portal Aquícola', url: 'https://portalaquicola.exemplo/rss.xml', everyMinutes: 60, state: 'active', lastReadAt: clock.ago(22), lastDay: 9, lastWeek: [7, 8, 11, 6, 9, 10, 9] },
    { id: 'feed-mar-mercado', name: 'Revista Mar & Mercado', url: 'https://maremercado.exemplo/feed', everyMinutes: 60, state: 'active', lastReadAt: clock.ago(41), lastDay: 6, lastWeek: [5, 4, 7, 6, 3, 5, 6] },
    { id: 'feed-seafood-wire', name: 'Seafood Wire', url: 'https://seafoodwire.exemplo/latest.rss', everyMinutes: 120, state: 'active', lastReadAt: clock.ago(57), lastDay: 11, lastWeek: [9, 12, 10, 8, 13, 11, 11] },
    { id: 'feed-pesquisa', name: 'Boletim de Pesquisa Aquícola', url: 'https://boletimaquicola.exemplo/rss', everyMinutes: 120, state: 'failing', lastReadAt: clock.ago(380), lastError: 'O endereço não respondeu em 30 segundos.', lastDay: 0, lastWeek: [6, 5, 7, 4, 2, 0, 0] },
  ];
}

export function seedNews(clock: Clock): NewsItem[] {
  return [
    {
      id: 'news-traceability-startup',
      title: 'Startup de rastreabilidade capta R$ 12 milhões para monitorar a cadeia do pescado',
      url: 'https://portalaquicola.exemplo/startup-rastreabilidade-capta',
      source: 'Portal Aquícola', feedId: 'feed-aquicola', via: 'rss',
      publishedAt: clock.ago(4), importedAt: clock.ago(2),
      excerpt: 'A rodada vai financiar sensores de temperatura em caminhões e câmaras frias de 30 cooperativas até o fim de 2027.',
      body: [
        'A rodada vai financiar sensores de temperatura em caminhões e câmaras frias de 30 cooperativas até o fim de 2027.',
        'Segundo a empresa, o sistema registra cada transferência do lote, do desembarque ao varejo, e alerta quando a temperatura sai da faixa.',
        'O aporte foi liderado por um fundo de agronegócio e inclui recursos de um banco de fomento regional.',
      ],
      duplicates: [],
      status: 'new',
    },
    {
      id: FLAGSHIP_NEWS_ID,
      title: 'Exportações de tilápia crescem 38% no terceiro trimestre',
      url: 'https://observatoriodopescado.exemplo/exportacoes-tilapia-terceiro-trimestre',
      source: 'Observatório do Pescado', feedId: 'feed-observatorio', via: 'rss',
      publishedAt: clock.ago(26), importedAt: clock.ago(24),
      excerpt: 'O Brasil embarcou 4,1 mil toneladas de tilápia entre julho e setembro, puxado por filés frescos para os Estados Unidos.',
      body: [
        'O Brasil embarcou 4,1 mil toneladas de tilápia entre julho e setembro, puxado por filés frescos para os Estados Unidos.',
        'A receita somou US$ 18,6 milhões, alta de 41% sobre o mesmo período de 2025. O preço médio por quilo subiu de US$ 4,32 para US$ 4,54.',
        'Paraná e São Paulo responderam por 72% do volume. Exportadores atribuem o resultado à abertura de novas rotas aéreas e à demanda do varejo norte-americano por filé fresco.',
        'O levantamento usa os dados mensais de comércio exterior e será atualizado em novembro.',
      ],
      duplicates: [
        { source: 'Agência Litoral', url: 'https://agencialitoral.exemplo/tilapia-exportacao-recorde', publishedAt: clock.ago(19) },
        { source: 'Revista Mar & Mercado', url: 'https://maremercado.exemplo/tilapia-trimestre', publishedAt: clock.ago(11) },
      ],
      classification: {
        score: 91, topic: 'Exportação e mercado', mapVersion: 4,
        summary: 'Dado novo de exportação, com série histórica e impacto direto nos produtores do Sul.',
        reasons: [
          { criterion: 'Exportação e mercado', effect: 'up', detail: 'Tema prioritário do mapa editorial.' },
          { criterion: 'Fonte com dados', effect: 'up', detail: 'Números comparáveis com o mesmo período do ano anterior.' },
          { criterion: 'Região', effect: 'up', detail: 'Paraná e São Paulo concentram o público do portal.' },
          { criterion: 'Recorte', effect: 'down', detail: 'Fala só de tilápia; outras espécies ficam de fora.' },
        ],
      },
      status: 'new',
    },
    {
      id: 'news-labeling-consultation',
      title: 'Governo abre consulta pública sobre rotulagem de pescado congelado',
      url: 'https://agencialitoral.exemplo/consulta-rotulagem-congelados',
      source: 'Agência Litoral', feedId: 'feed-litoral', via: 'rss',
      publishedAt: clock.ago(48), importedAt: clock.ago(45),
      excerpt: 'A proposta obriga informar o percentual de glaciamento na frente da embalagem. Contribuições vão até 30 de novembro.',
      body: [
        'A proposta obriga informar o percentual de glaciamento na frente da embalagem, com letras de pelo menos 4 milímetros.',
        'Indústrias terão 18 meses para se adaptar depois da publicação da norma. Contribuições vão até 30 de novembro.',
        'Entidades do varejo defendem que a regra vale também para produtos importados.',
      ],
      duplicates: [{ source: 'Portal Aquícola', url: 'https://portalaquicola.exemplo/rotulagem-glaciamento', publishedAt: clock.ago(30) }],
      classification: {
        score: 88, topic: 'Sanidade e regulação', mapVersion: 4,
        summary: 'Regra nova afeta indústria e varejo, com prazo curto para o setor se manifestar.',
        reasons: [
          { criterion: 'Sanidade e regulação', effect: 'up', detail: 'Tema prioritário do mapa editorial.' },
          { criterion: 'Prazo', effect: 'up', detail: 'Consulta fecha em 30 de novembro.' },
          { criterion: 'Fonte', effect: 'down', detail: 'Ainda sem o texto oficial da proposta.' },
        ],
      },
      status: 'new',
    },
    {
      id: 'news-cooperative-plant',
      title: 'Cooperativa do Paraná inaugura frigorífico de peixes para 60 toneladas por dia',
      url: 'https://portalaquicola.exemplo/cooperativa-frigorifico-60-toneladas',
      source: 'Portal Aquícola', feedId: 'feed-aquicola', via: 'rss',
      publishedAt: clock.ago(115), importedAt: clock.ago(98),
      excerpt: 'A planta em Toledo recebeu R$ 180 milhões e deve gerar 420 empregos diretos até o fim de 2027.',
      body: [
        'A planta em Toledo recebeu R$ 180 milhões e deve gerar 420 empregos diretos até o fim de 2027.',
        'O frigorífico vai processar tilápia de 340 produtores associados e tem área reservada para filés congelados de exportação.',
      ],
      duplicates: [{ source: 'Agência Litoral', url: 'https://agencialitoral.exemplo/frigorifico-toledo', publishedAt: clock.ago(80) }],
      classification: {
        score: 84, topic: 'Indústria e processamento', mapVersion: 4,
        summary: 'Investimento grande em uma região-chave, com efeito na oferta de tilápia.',
        reasons: [
          { criterion: 'Indústria e processamento', effect: 'up', detail: 'Tema prioritário do mapa editorial.' },
          { criterion: 'Região', effect: 'up', detail: 'Oeste do Paraná é o maior polo de tilápia do país.' },
        ],
      },
      status: 'new',
    },
    {
      id: 'news-shrimp-price',
      title: 'Preço do camarão no atacado sobe pela quarta semana seguida',
      url: 'https://maremercado.exemplo/camarao-atacado-quarta-semana',
      source: 'Revista Mar & Mercado', feedId: 'feed-mar-mercado', via: 'rss',
      publishedAt: clock.ago(84), importedAt: clock.ago(70),
      excerpt: 'O quilo do camarão cinza médio chegou a R$ 46 nas centrais de abastecimento do Nordeste, alta de 12% no mês.',
      body: [
        'O quilo do camarão cinza médio chegou a R$ 46 nas centrais de abastecimento do Nordeste, alta de 12% no mês.',
        'Produtores apontam chuvas fora de época e a mancha branca em viveiros do Ceará como causas da menor oferta.',
      ],
      duplicates: [],
      classification: {
        score: 79, topic: 'Exportação e mercado', mapVersion: 4,
        summary: 'Movimento de preço relevante para compradores, mas falta uma fonte além da revista.',
        reasons: [
          { criterion: 'Exportação e mercado', effect: 'up', detail: 'Preço é tema recorrente do público comprador.' },
          { criterion: 'Fonte única', effect: 'down', detail: 'Nenhuma outra fonte confirmou o número até agora.' },
        ],
      },
      status: 'new',
    },
    {
      id: 'news-tainha-closed-season',
      title: 'Defeso da tainha começa em 1º de novembro no litoral Sul',
      url: 'https://agencialitoral.exemplo/defeso-tainha-novembro',
      source: 'Agência Litoral', feedId: 'feed-litoral', via: 'rss',
      publishedAt: clock.ago(170), importedAt: clock.ago(160),
      excerpt: 'A pesca da espécie fica proibida por quatro meses em Santa Catarina, Paraná e Rio Grande do Sul.',
      body: [
        'A pesca da espécie fica proibida por quatro meses em Santa Catarina, Paraná e Rio Grande do Sul.',
        'Pescadores artesanais cadastrados recebem o seguro-defeso durante o período.',
      ],
      duplicates: [],
      classification: {
        score: 72, topic: 'Pesca', mapVersion: 4,
        summary: 'Assunto de serviço, previsível, que o portal costuma registrar todo ano.',
        reasons: [
          { criterion: 'Pesca', effect: 'up', detail: 'Tema coberto pelo mapa editorial.' },
          { criterion: 'Novidade', effect: 'down', detail: 'O calendário é o mesmo do ano passado.' },
        ],
      },
      status: 'new',
    },
    {
      id: 'news-salmon-harvest',
      title: 'Produtores chilenos revisam para baixo a colheita de salmão em 2027',
      url: 'https://seafoodwire.exemplo/chile-salmon-harvest-2027',
      source: 'Seafood Wire', feedId: 'feed-seafood-wire', via: 'rss',
      publishedAt: clock.ago(260), importedAt: clock.ago(200),
      excerpt: 'A projeção caiu 4%, para 980 mil toneladas, por causa de florações de algas no sul do país.',
      body: [
        'A projeção caiu 4%, para 980 mil toneladas, por causa de florações de algas no sul do país.',
        'O Brasil é o segundo maior comprador do salmão chileno, atrás dos Estados Unidos.',
      ],
      duplicates: [],
      classification: {
        score: 70, topic: 'Exportação e mercado', mapVersion: 4,
        summary: 'Afeta preço do salmão no Brasil; texto original em inglês.',
        reasons: [
          { criterion: 'Mercado internacional', effect: 'up', detail: 'O Brasil é o segundo maior comprador.' },
          { criterion: 'Idioma', effect: 'down', detail: 'Apuração em inglês leva mais tempo.' },
        ],
      },
      status: 'new',
    },
    {
      id: 'news-lobster-quota',
      title: 'Exportadores de lagosta pedem revisão da cota para 2026',
      url: 'https://agencialitoral.exemplo/lagosta-cota-revisao',
      source: 'Agência Litoral', feedId: 'feed-litoral', via: 'rss',
      publishedAt: clock.ago(300), importedAt: clock.ago(290),
      excerpt: 'O setor quer ampliar o limite de captura em 15% e promete reforçar a fiscalização das armadilhas.',
      body: ['O setor quer ampliar o limite de captura em 15% e promete reforçar a fiscalização das armadilhas.'],
      duplicates: [],
      classification: {
        score: 68, topic: 'Pesca', mapVersion: 4,
        summary: 'Disputa regulatória com impacto em exportação, ainda sem posição do governo.',
        reasons: [
          { criterion: 'Pesca', effect: 'up', detail: 'Tema coberto pelo mapa editorial.' },
          { criterion: 'Posição oficial', effect: 'down', detail: 'Só um lado se manifestou.' },
        ],
      },
      status: 'new',
    },
    {
      id: 'news-insect-feed',
      title: 'Pesquisa testa ração com farinha de inseto para tambaqui',
      url: 'https://observatoriodopescado.exemplo/racao-inseto-tambaqui',
      source: 'Observatório do Pescado', feedId: 'feed-observatorio', via: 'rss',
      publishedAt: clock.ago(330), importedAt: clock.ago(320),
      excerpt: 'O experimento substituiu 30% da proteína de peixe e manteve o ganho de peso em 120 dias.',
      body: [
        'O experimento substituiu 30% da proteína de peixe e manteve o ganho de peso em 120 dias.',
        'Os autores pedem cautela: a amostra teve 600 peixes em um único viveiro.',
      ],
      duplicates: [],
      classification: {
        score: 63, topic: 'Aquicultura', mapVersion: 4,
        summary: 'Pesquisa relevante, mas inicial; pede cuidado com o tamanho da amostra.',
        reasons: [
          { criterion: 'Aquicultura', effect: 'up', detail: 'Tema prioritário do mapa editorial.' },
          { criterion: 'Evidência', effect: 'down', detail: 'Estudo em um único viveiro.' },
        ],
      },
      status: 'new',
    },
    {
      id: 'news-retail-fresh',
      title: 'Rede de supermercados amplia seção de pescados frescos em 40 lojas',
      url: 'https://maremercado.exemplo/rede-amplia-pescados-frescos',
      source: 'Revista Mar & Mercado', feedId: 'feed-mar-mercado', via: 'rss',
      publishedAt: clock.ago(380), importedAt: clock.ago(370),
      excerpt: 'A rede vai treinar 200 atendentes e quer dobrar as vendas de peixe fresco até 2027.',
      body: ['A rede vai treinar 200 atendentes e quer dobrar as vendas de peixe fresco até 2027.'],
      duplicates: [],
      classification: {
        score: 58, topic: 'Varejo e consumo', mapVersion: 4,
        summary: 'Bom sinal de consumo, mas é anúncio de uma empresa, sem dados de venda.',
        reasons: [
          { criterion: 'Varejo e consumo', effect: 'up', detail: 'Tema coberto pelo mapa editorial.' },
          { criterion: 'Caráter promocional', effect: 'down', detail: 'Só a empresa fala no texto.' },
        ],
      },
      status: 'new',
    },
    {
      id: 'news-festival',
      title: 'Festival gastronômico do litoral anuncia programação de novembro',
      url: 'https://agencialitoral.exemplo/festival-gastronomico-novembro',
      source: 'Agência Litoral', feedId: 'feed-litoral', via: 'rss',
      publishedAt: clock.ago(400), importedAt: clock.ago(395),
      excerpt: 'Serão 12 dias de pratos com frutos do mar em 30 restaurantes da orla.',
      body: ['Serão 12 dias de pratos com frutos do mar em 30 restaurantes da orla.'],
      duplicates: [],
      classification: {
        score: 22, topic: 'Eventos', mapVersion: 4,
        summary: 'Agenda de consumo local, fora do recorte do portal.',
        reasons: [
          { criterion: 'Público', effect: 'down', detail: 'Interessa ao consumidor final, não à cadeia produtiva.' },
          { criterion: 'Exclusão', effect: 'down', detail: '"Agenda cultural" está entre as exclusões do mapa.' },
        ],
      },
      status: 'new',
    },
    {
      id: 'news-fishmeal-price',
      title: 'Preço da farinha de peixe sobe 12% e pressiona o custo da ração',
      url: 'https://seafoodwire.exemplo/farinha-de-peixe-preco-racao',
      source: 'Seafood Wire', feedId: 'feed-seafood-wire', via: 'rss',
      publishedAt: clock.ago(540), importedAt: clock.ago(536),
      excerpt: 'A tonelada da farinha de peixe chegou a US$ 2.050 em outubro, a maior cotação desde 2022.',
      body: [
        'A tonelada da farinha de peixe chegou a US$ 2.050 em outubro, a maior cotação desde 2022.',
        'A alta vem da cota menor de anchoveta no Peru, principal origem do insumo.',
        'Fabricantes de ração dizem que o reajuste chega ao produtor brasileiro em até 60 dias.',
      ],
      duplicates: [],
      classification: {
        score: 77, topic: 'Aquicultura', mapVersion: 4,
        summary: 'Custo de produção do piscicultor com número novo e prazo para chegar ao Brasil.',
        reasons: [
          { criterion: 'Aquicultura', effect: 'up', detail: 'Tema prioritário do mapa editorial.' },
          { criterion: 'Fonte com dados', effect: 'up', detail: 'Cotação comparada com os anos anteriores.' },
        ],
      },
      status: 'new',
    },
    {
      id: 'news-pirarucu-quota',
      title: 'Manejo do pirarucu no Amazonas libera cota recorde para 2027',
      url: 'https://observatoriodopescado.exemplo/pirarucu-manejo-cota-2027',
      source: 'Observatório do Pescado', feedId: 'feed-observatorio', via: 'rss',
      publishedAt: clock.ago(450), importedAt: clock.ago(446),
      excerpt: 'O Ibama autorizou a pesca de 98 mil pirarucus em áreas de manejo comunitário, 15% a mais que neste ano.',
      body: [
        'O Ibama autorizou a pesca de 98 mil pirarucus em áreas de manejo comunitário, 15% a mais que neste ano.',
        'A contagem dos peixes é feita pelos próprios pescadores, com acompanhamento técnico.',
      ],
      duplicates: [{ source: 'Agência Litoral', url: 'https://agencialitoral.exemplo/pirarucu-manejo-cota-2027', publishedAt: clock.ago(410) }],
      classification: {
        score: 74, topic: 'Pesca', mapVersion: 4,
        summary: 'Dado oficial de cota, com impacto direto em comunidades de pesca.',
        reasons: [
          { criterion: 'Pesca', effect: 'up', detail: 'Tema do mapa editorial.' },
          { criterion: 'Região', effect: 'down', detail: 'O Norte tem pouco público no portal.' },
        ],
      },
      status: 'new',
    },
    {
      id: 'news-port-dredging',
      title: 'Dragagem do porto de Rio Grande atrasa e afeta o escoamento de pescado',
      url: 'https://maremercado.exemplo/rio-grande-dragagem-atraso',
      source: 'Revista Mar & Mercado', feedId: 'feed-mar-mercado', via: 'rss',
      publishedAt: clock.ago(660), importedAt: clock.ago(656),
      excerpt: 'A obra, prevista para setembro, ficou para março e limita o calado dos navios frigoríficos.',
      body: [
        'A obra, prevista para setembro, ficou para março e limita o calado dos navios frigoríficos.',
        'Exportadores gaúchos estimam custo extra de frete de R$ 4 milhões no período.',
      ],
      duplicates: [],
      classification: {
        score: 56, topic: 'Logística', mapVersion: 4,
        summary: 'Logística de exportação regional; vale acompanhar o prazo da obra.',
        reasons: [
          { criterion: 'Exportação e mercado', effect: 'up', detail: 'Afeta quem exporta pelo Sul.' },
          { criterion: 'Fonte', effect: 'down', detail: 'Só os exportadores falam; falta a autoridade portuária.' },
        ],
      },
      status: 'new',
    },
    {
      id: 'news-mussel-harvest',
      title: 'Santa Catarina colhe 13 mil toneladas de mexilhão na safra',
      url: 'https://agencialitoral.exemplo/santa-catarina-safra-mexilhao',
      source: 'Agência Litoral', feedId: 'feed-litoral', via: 'rss',
      publishedAt: clock.ago(840), importedAt: clock.ago(836),
      excerpt: 'A safra de mexilhão em Santa Catarina fechou em 13 mil toneladas, 9% acima da anterior.',
      body: [
        'A safra de mexilhão em Santa Catarina fechou em 13 mil toneladas, 9% acima da anterior.',
        'Palhoça e Governador Celso Ramos concentram 70% da produção.',
      ],
      duplicates: [{ source: 'Portal Aquícola', url: 'https://portalaquicola.exemplo/santa-catarina-safra-mexilhao', publishedAt: clock.ago(785) }],
      classification: {
        score: 67, topic: 'Aquicultura', mapVersion: 4,
        summary: 'Balanço de safra com número e região; bom para a editoria de aquicultura.',
        reasons: [
          { criterion: 'Aquicultura', effect: 'up', detail: 'Tema prioritário do mapa editorial.' },
          { criterion: 'Novidade', effect: 'down', detail: 'O balanço sai todo ano no mesmo período.' },
        ],
      },
      status: 'new',
    },
    {
      id: 'news-chile-salmon-virus',
      title: 'Chile confirma surto de vírus em três centros de cultivo de salmão',
      url: 'https://seafoodwire.exemplo/chile-salmao-surto-virus',
      source: 'Seafood Wire', feedId: 'feed-seafood-wire', via: 'rss',
      publishedAt: clock.ago(1140), importedAt: clock.ago(1136),
      excerpt: 'O serviço sanitário chileno confirmou casos de anemia infecciosa em três centros da região de Aysén.',
      body: [
        'O serviço sanitário chileno confirmou casos de anemia infecciosa em três centros da região de Aysén.',
        'Os centros foram isolados e a colheita foi antecipada.',
      ],
      duplicates: [],
      classification: {
        score: 62, topic: 'Sanidade e regulação', mapVersion: 4,
        summary: 'Sanidade no maior fornecedor de salmão do Brasil; pode afetar a oferta.',
        reasons: [
          { criterion: 'Sanidade e regulação', effect: 'up', detail: 'Tema do mapa editorial.' },
          { criterion: 'Região', effect: 'down', detail: 'Fato no exterior, com efeito indireto.' },
        ],
      },
      status: 'new',
    },
    {
      id: 'news-fish-friday',
      title: 'Campanha incentiva o consumo de peixe às sextas-feiras',
      url: 'https://portalaquicola.exemplo/campanha-peixe-sexta-feira',
      source: 'Portal Aquícola', feedId: 'feed-aquicola', via: 'rss',
      publishedAt: clock.ago(1380), importedAt: clock.ago(1376),
      excerpt: 'Varejistas e associações lançaram uma campanha com descontos em peixe fresco às sextas.',
      body: [
        'Varejistas e associações lançaram uma campanha com descontos em peixe fresco às sextas.',
        'A ação vai até dezembro em 400 lojas de seis estados.',
      ],
      duplicates: [],
      classification: {
        score: 41, topic: 'Varejo e consumo', mapVersion: 4,
        summary: 'Ação de varejo, mais próxima do consumidor final que da cadeia.',
        reasons: [
          { criterion: 'Público', effect: 'down', detail: 'Interessa mais ao consumidor final.' },
        ],
      },
      status: 'new',
    },
    {
      id: 'news-aquarium-expo',
      title: 'Exposição de aquarismo reúne 40 mil visitantes em São Paulo',
      url: 'https://maremercado.exemplo/exposicao-aquarismo-sao-paulo',
      source: 'Revista Mar & Mercado', feedId: 'feed-mar-mercado', via: 'rss',
      publishedAt: clock.ago(1680), importedAt: clock.ago(1676),
      excerpt: 'A feira de aquarismo ornamental teve recorde de público e 120 expositores.',
      body: [
        'A feira de aquarismo ornamental teve recorde de público e 120 expositores.',
        'O setor de peixes ornamentais movimenta R$ 1 bilhão por ano no país.',
      ],
      duplicates: [],
      classification: {
        score: 12, topic: 'Eventos', mapVersion: 4,
        summary: 'Peixe ornamental, fora do recorte do portal.',
        reasons: [
          { criterion: 'Exclusão', effect: 'down', detail: 'Aquarismo está entre as exclusões do mapa.' },
        ],
      },
      status: 'new',
    },
    {
      id: RESEARCH_NEWS_ID,
      title: 'Porto de Itajaí registra recorde de contêineres refrigerados',
      url: 'https://agencialitoral.exemplo/itajai-recorde-reefer',
      source: 'Agência Litoral', feedId: 'feed-litoral', via: 'rss',
      publishedAt: clock.ago(1_150), importedAt: clock.ago(1_140),
      excerpt: 'O porto movimentou 38 mil contêineres refrigerados em setembro, 22% a mais que no ano passado.',
      body: [
        'O porto movimentou 38 mil contêineres refrigerados em setembro, 22% a mais que no ano passado.',
        'Carnes e pescados respondem pela maior parte da carga.',
      ],
      duplicates: [],
      classification: {
        score: 76, topic: 'Exportação e mercado', mapVersion: 4,
        summary: 'Logística de exportação com dado novo; precisa separar o peso do pescado.',
        reasons: [
          { criterion: 'Exportação e mercado', effect: 'up', detail: 'Tema prioritário do mapa editorial.' },
          { criterion: 'Recorte', effect: 'down', detail: 'O número inclui carnes.' },
        ],
      },
      status: 'covered', decidedBy: 'Clara Souto', decidedAt: clock.ago(1_000),
    },
    {
      id: ARTICLE_NEWS_ID,
      title: 'Banco de fomento abre linha de R$ 400 milhões para piscicultores',
      url: 'https://portalaquicola.exemplo/linha-credito-piscicultores',
      source: 'Portal Aquícola', feedId: 'feed-aquicola', via: 'rss',
      publishedAt: clock.ago(1_500), importedAt: clock.ago(1_480),
      excerpt: 'O crédito financia tanques, aeradores e energia solar, com juros de 7% ao ano e carência de dois anos.',
      body: [
        'O crédito financia tanques, aeradores e energia solar, com juros de 7% ao ano e carência de dois anos.',
        'Podem pedir produtores com receita anual de até R$ 4,8 milhões. Os pedidos abrem em 3 de novembro.',
      ],
      duplicates: [{ source: 'Observatório do Pescado', url: 'https://observatoriodopescado.exemplo/credito-piscicultura', publishedAt: clock.ago(1_400) }],
      classification: {
        score: 86, topic: 'Aquicultura', mapVersion: 4,
        summary: 'Serviço direto para o produtor, com valores e prazos claros.',
        reasons: [
          { criterion: 'Aquicultura', effect: 'up', detail: 'Tema prioritário do mapa editorial.' },
          { criterion: 'Serviço', effect: 'up', detail: 'O leitor pode agir: pedidos abrem em 3 de novembro.' },
        ],
      },
      status: 'covered', decidedBy: 'João', decidedAt: clock.ago(1_300),
    },
    {
      id: 'news-canned-sardine',
      title: 'Indústria de enlatados prevê alta nas vendas de sardinha no fim do ano',
      url: 'https://maremercado.exemplo/enlatados-sardinha-fim-de-ano',
      source: 'Revista Mar & Mercado', feedId: 'feed-mar-mercado', via: 'rss',
      publishedAt: clock.ago(900), importedAt: clock.ago(880),
      excerpt: 'Fabricantes esperam vender 8% mais no último trimestre, com a sardinha mais barata que a carne bovina.',
      body: ['Fabricantes esperam vender 8% mais no último trimestre, com a sardinha mais barata que a carne bovina.'],
      duplicates: [],
      classification: {
        score: 61, topic: 'Indústria e processamento', mapVersion: 4,
        summary: 'Projeção de entidade, boa para fechar a semana.',
        reasons: [{ criterion: 'Indústria e processamento', effect: 'up', detail: 'Tema prioritário do mapa editorial.' }],
      },
      status: 'later', decidedBy: 'Rafael Dias', decidedAt: clock.ago(850), laterUntil: clock.ago(-720),
    },
    {
      id: 'news-airfryer',
      title: 'Influenciador ensina receita de peixe na airfryer e viraliza',
      url: 'https://agencialitoral.exemplo/receita-peixe-airfryer',
      source: 'Agência Litoral', feedId: 'feed-litoral', via: 'rss',
      publishedAt: clock.ago(700), importedAt: clock.ago(690),
      excerpt: 'O vídeo passou de 2 milhões de visualizações em dois dias.',
      body: ['O vídeo passou de 2 milhões de visualizações em dois dias.'],
      duplicates: [],
      classification: {
        score: 9, topic: 'Varejo e consumo', mapVersion: 4,
        summary: 'Entretenimento para o consumidor final.',
        reasons: [{ criterion: 'Público', effect: 'down', detail: 'Fora do recorte da cadeia produtiva.' }],
      },
      status: 'discarded', decidedBy: 'João', decidedAt: clock.ago(680), discardReason: 'Fora do mapa editorial',
    },
  ];
}

export const DESK_GOAL: DeskGoal = { perDay: 8 };

export function seedEditorialMap(clock: Clock): EditorialMap {
  return {
    version: 4,
    updatedAt: clock.ago(9_000),
    updatedBy: 'Pedro',
    audience: 'Produtores, indústria, distribuidores e compradores da cadeia do pescado.',
    regions: ['Brasil', 'Sul', 'Nordeste', 'Mercado internacional'],
    topics: [
      { id: 'exports', label: 'Exportação e mercado', weight: 'core' },
      { id: 'aquaculture', label: 'Aquicultura', weight: 'core' },
      { id: 'industry', label: 'Indústria e processamento', weight: 'core' },
      { id: 'regulation', label: 'Sanidade e regulação', weight: 'core' },
      { id: 'fishing', label: 'Pesca', weight: 'regular' },
      { id: 'retail', label: 'Varejo e consumo', weight: 'regular' },
      { id: 'sustainability', label: 'Sustentabilidade', weight: 'regular' },
      { id: 'events', label: 'Eventos', weight: 'occasional' },
    ],
    exclusions: ['Receitas', 'Agenda cultural', 'Aquarismo', 'Celebridades', 'Política partidária'],
    trusted: ['Observatório do Pescado', 'Portal Aquícola', 'Agência Litoral'],
    blocked: ['Sites de cupons', 'Blogs sem autoria'],
  };
}

export function seedWritingGuide(clock: Clock): WritingGuide {
  return {
    version: 3,
    updatedAt: clock.ago(12_000),
    updatedBy: 'Pedro',
    voice: 'Direto, técnico e sem adjetivos. Escrevemos para quem trabalha no setor.',
    headline: 'Verbo no presente, fato principal e número quando houver. Até 90 caracteres.',
    lead: 'Responde o quê, quem, quando e quanto na primeira frase. Até 40 palavras.',
    attribution: 'Todo número e toda opinião têm fonte nomeada. Use "segundo" ou "de acordo com"; "disse" para falas.',
    rules: [
      { id: 'r1', text: 'Números até dez por extenso; acima, em algarismos.' },
      { id: 'r2', text: 'Moeda com símbolo: R$ 18 milhões, US$ 4,54.' },
      { id: 'r3', text: 'Siglas por extenso na primeira menção.' },
      { id: 'r4', text: 'Intertítulos a cada três ou quatro parágrafos em textos de duas laudas.' },
      { id: 'r5', text: 'Nada de "vale lembrar", "é importante destacar" ou "confira".' },
    ],
    terms: [
      { avoid: 'pescados', use: 'pescado (coletivo)' },
      { avoid: 'piscicultura de tilápias', use: 'tilapicultura' },
      { avoid: 'alavancar', use: 'aumentar' },
      { avoid: 'players', use: 'empresas' },
    ],
    examples: [
      { id: 'e1', title: 'Exportação de pescado fecha semestre com alta de 19%', url: 'https://portal-do-pescado.exemplo/exportacao-semestre', note: 'Lead com número, fonte e comparação.' },
      { id: 'e2', title: 'Nova norma de inspeção muda rotina de frigoríficos', url: 'https://portal-do-pescado.exemplo/norma-inspecao', note: 'Explica a regra antes da reação do setor.' },
    ],
  };
}

/** What the AI answers for a news item that arrives during the session (F2.4 preview). */
export function classificationFor(item: NewsItem, mapVersion: number): NonNullable<NewsItem['classification']> {
  const arrival = ARRIVAL_READINGS[baseArrivalId(item.id)];
  if (arrival) return { ...arrival, mapVersion };
  if (item.id === 'news-traceability-startup') {
    return {
      score: 81, topic: 'Indústria e processamento', mapVersion,
      summary: 'Investimento em rastreabilidade com cooperativas, tema que o portal acompanha.',
      reasons: [
        { criterion: 'Indústria e processamento', effect: 'up', detail: 'Tema prioritário do mapa editorial.' },
        { criterion: 'Acervo', effect: 'up', detail: 'O portal já publicou sobre sensores de temperatura.' },
        { criterion: 'Fonte', effect: 'down', detail: 'Só a empresa fala; falta ouvir as cooperativas.' },
      ],
    };
  }
  return {
    score: 64, topic: 'Indústria e processamento', mapVersion,
    summary: 'Tema dentro do mapa editorial; confira a fonte antes de cobrir.',
    reasons: [
      { criterion: 'Mapa editorial', effect: 'up', detail: 'Assunto coberto pelo portal.' },
      { criterion: 'Fonte', effect: 'down', detail: 'Endereço fora das fontes acompanhadas.' },
    ],
  };
}
