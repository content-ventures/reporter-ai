import type { NewsClassification, NewsDuplicate, NewsItem } from '@/domain/hard-news';
import type { Clock } from './news';

/**
 * What the preview's radar receives while the desk is open: an outlet joining a story, then new
 * stories at their own pace (one with high priority). The backend replaces this with the RSS
 * ingestion; the radar reads the same records. Each visit after a break plays a new round, so the
 * radar never goes quiet; each arrival happens once per round.
 */

export type Arrival =
  | { id: string; afterSeconds: number; kind: 'news'; build: (clock: Clock) => NewsItem }
  | { id: string; afterSeconds: number; kind: 'duplicate'; newsId: string; build: (clock: Clock) => NewsDuplicate };

const FIRST_ROUND: readonly Arrival[] = [
  {
    id: 'arrival-tilapia-wire',
    afterSeconds: 40,
    kind: 'duplicate',
    newsId: 'news-tilapia-exports',
    build: (clock) => ({ source: 'Seafood Wire', url: 'https://seafoodwire.exemplo/brazil-tilapia-exports-q3', publishedAt: clock.ago(0) }),
  },
  {
    id: 'news-import-inspection',
    afterSeconds: 90,
    kind: 'news',
    build: (clock) => ({
      id: 'news-import-inspection',
      title: 'Portaria muda a inspeção de pescado importado a partir de dezembro',
      url: 'https://observatoriodopescado.exemplo/portaria-inspecao-pescado-importado',
      source: 'Observatório do Pescado', feedId: 'feed-observatorio', via: 'rss',
      publishedAt: clock.ago(1), importedAt: clock.ago(0),
      excerpt: 'Lotes importados passam a ter análise laboratorial obrigatória antes da liberação, e não mais por amostragem.',
      body: [
        'Lotes importados passam a ter análise laboratorial obrigatória antes da liberação, e não mais por amostragem.',
        'A portaria vale para peixes, crustáceos e moluscos e entra em vigor em 1º de dezembro.',
        'Importadores estimam que a liberação dos contêineres leve de três a cinco dias a mais.',
      ],
      duplicates: [],
      status: 'new',
    }),
  },
  {
    id: 'news-toledo-fair',
    afterSeconds: 240,
    kind: 'news',
    build: (clock) => ({
      id: 'news-toledo-fair',
      title: 'Feira de aquicultura de Toledo confirma 180 expositores para março',
      url: 'https://portalaquicola.exemplo/feira-aquicultura-toledo-2027',
      source: 'Portal Aquícola', feedId: 'feed-aquicola', via: 'rss',
      publishedAt: clock.ago(2), importedAt: clock.ago(0),
      excerpt: 'A feira, a maior de piscicultura do país, espera 25 mil visitantes em três dias.',
      body: [
        'A feira, a maior de piscicultura do país, espera 25 mil visitantes em três dias.',
        'A programação inclui um dia dedicado à exportação de tilápia.',
      ],
      duplicates: [],
      status: 'new',
    }),
  },
  {
    id: 'news-tilapia-recipes',
    afterSeconds: 420,
    kind: 'news',
    build: (clock) => ({
      id: 'news-tilapia-recipes',
      title: 'Chef ensina cinco receitas com tilápia para o verão',
      url: 'https://maremercado.exemplo/receitas-tilapia-verao',
      source: 'Revista Mar & Mercado', feedId: 'feed-mar-mercado', via: 'rss',
      publishedAt: clock.ago(1), importedAt: clock.ago(0),
      excerpt: 'Ceviche, moqueca e grelhados estão entre as sugestões para a temporada.',
      body: ['Ceviche, moqueca e grelhados estão entre as sugestões para a temporada.'],
      duplicates: [],
      status: 'new',
    }),
  },
];

const NEXT_ROUND: readonly Arrival[] = [
  {
    id: 'news-china-shrimp',
    afterSeconds: 60,
    kind: 'news',
    build: (clock) => ({
      id: 'news-china-shrimp',
      title: 'China habilita mais 12 frigoríficos brasileiros a exportar camarão',
      url: 'https://agencialitoral.exemplo/china-habilita-frigorificos-camarao',
      source: 'Agência Litoral', feedId: 'feed-litoral', via: 'rss',
      publishedAt: clock.ago(1), importedAt: clock.ago(0),
      excerpt: 'Com a lista nova, o Brasil passa a ter 31 plantas autorizadas a vender camarão para o mercado chinês.',
      body: [
        'Com a lista nova, o Brasil passa a ter 31 plantas autorizadas a vender camarão para o mercado chinês.',
        'Ceará e Rio Grande do Norte concentram nove das doze unidades habilitadas.',
      ],
      duplicates: [],
      status: 'new',
    }),
  },
  {
    id: 'news-solar-ponds',
    afterSeconds: 200,
    kind: 'news',
    build: (clock) => ({
      id: 'news-solar-ponds',
      title: 'Cooperativa instala usina solar flutuante sobre tanques de tilápia',
      url: 'https://portalaquicola.exemplo/usina-solar-flutuante-tilapia',
      source: 'Portal Aquícola', feedId: 'feed-aquicola', via: 'rss',
      publishedAt: clock.ago(2), importedAt: clock.ago(0),
      excerpt: 'Os painéis cobrem 4 hectares de lâmina d’água e devem reduzir em 40% a conta de energia dos associados.',
      body: ['Os painéis cobrem 4 hectares de lâmina d’água e devem reduzir em 40% a conta de energia dos associados.'],
      duplicates: [],
      status: 'new',
    }),
  },
  {
    id: 'news-fishing-tournament',
    afterSeconds: 360,
    kind: 'news',
    build: (clock) => ({
      id: 'news-fishing-tournament',
      title: 'Torneio de pesca esportiva reúne 300 barcos em Florianópolis',
      url: 'https://agencialitoral.exemplo/torneio-pesca-esportiva-florianopolis',
      source: 'Agência Litoral', feedId: 'feed-litoral', via: 'rss',
      publishedAt: clock.ago(1), importedAt: clock.ago(0),
      excerpt: 'A competição premia a maior captura de anchova e segue até domingo.',
      body: ['A competição premia a maior captura de anchova e segue até domingo.'],
      duplicates: [],
      status: 'new',
    }),
  },
];

/** The base id of an arrival of a later round (`news-x-r4` → `news-x`). */
export function baseArrivalId(id: string): string {
  return id.replace(/-r\d+$/, '');
}

/**
 * The arrivals of a round: the first one (with an outlet joining the tilápia story), then the
 * two sets of new stories alternating. From round 2 on, ids carry the round, so a story can come
 * back as a new arrival without clashing with the one already on the desk.
 */
export function arrivalsFor(round: number): Arrival[] {
  if (round <= 0) return [...FIRST_ROUND];
  const set = round % 2 === 1 ? NEXT_ROUND : FIRST_ROUND.filter((arrival) => arrival.kind === 'news');
  if (round < 2) return [...set];
  const suffix = `-r${round}`;
  return set.map((arrival) => (arrival.kind === 'news'
    ? { ...arrival, id: `${arrival.id}${suffix}`, build: (clock: Clock) => { const item = arrival.build(clock); return { ...item, id: `${item.id}${suffix}`, url: `${item.url}${suffix}` }; } }
    : arrival));
}

/** The AI's reading of each simulated arrival (applied a few seconds after it lands). */
export const ARRIVAL_READINGS: Record<string, Omit<NewsClassification, 'mapVersion'>> = {
  'news-import-inspection': {
    score: 93, topic: 'Sanidade e regulação',
    summary: 'Regra nova com data e efeito direto em quem importa; o leitor precisa saber hoje.',
    reasons: [
      { criterion: 'Sanidade e regulação', effect: 'up', detail: 'Tema prioritário do mapa editorial.' },
      { criterion: 'Prazo', effect: 'up', detail: 'Vale a partir de 1º de dezembro.' },
      { criterion: 'Fonte', effect: 'up', detail: 'O Observatório está entre as fontes confiáveis.' },
    ],
  },
  'news-toledo-fair': {
    score: 66, topic: 'Aquicultura',
    summary: 'Agenda do setor no Paraná; boa nota curta para a semana.',
    reasons: [
      { criterion: 'Aquicultura', effect: 'up', detail: 'Tema prioritário do mapa editorial.' },
      { criterion: 'Novidade', effect: 'down', detail: 'A feira acontece todo ano.' },
    ],
  },
  'news-china-shrimp': {
    score: 89, topic: 'Exportação e mercado',
    summary: 'Abertura de mercado com número e estados; afeta direto quem exporta camarão.',
    reasons: [
      { criterion: 'Exportação e mercado', effect: 'up', detail: 'Tema prioritário do mapa editorial.' },
      { criterion: 'Região', effect: 'up', detail: 'Nordeste concentra os produtores de camarão do público.' },
    ],
  },
  'news-solar-ponds': {
    score: 63, topic: 'Aquicultura',
    summary: 'Custo de energia do piscicultor, com número; boa matéria de serviço.',
    reasons: [
      { criterion: 'Aquicultura', effect: 'up', detail: 'Tema prioritário do mapa editorial.' },
      { criterion: 'Fonte', effect: 'down', detail: 'Só a cooperativa fala até agora.' },
    ],
  },
  'news-fishing-tournament': {
    score: 15, topic: 'Eventos',
    summary: 'Pesca esportiva, fora do recorte da cadeia produtiva.',
    reasons: [{ criterion: 'Exclusão', effect: 'down', detail: 'Pesca amadora está fora do mapa editorial.' }],
  },
  'news-tilapia-recipes': {
    score: 18, topic: 'Varejo e consumo',
    summary: 'Receitas para o consumidor final, fora do recorte do portal.',
    reasons: [{ criterion: 'Público', effect: 'down', detail: 'Interessa ao consumidor final, não à cadeia produtiva.' }],
  },
};
