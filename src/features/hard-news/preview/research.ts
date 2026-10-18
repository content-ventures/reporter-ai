import { headingBlock, paragraphBlock, quoteBlock } from '@/domain';
import type { ArticleBlock, ArticleBody, Inline } from '@/domain';
import type {
  ArchiveArticle,
  BankQuote,
  EnrichmentSuggestion,
  EvidenceFlag,
  HardNewsOutline,
  NewsItem,
  ResearchSource,
} from '@/domain/hard-news';
import { acceptedSources } from '@/domain/hard-news';
import type { Clock } from './news';
import { ARTICLE_NEWS_ID, FLAGSHIP_NEWS_ID, RESEARCH_NEWS_ID } from './news';

/**
 * Preview of web research (F2.6), outline and Hard News writing (F2.7), evidence flags (F2.8) and
 * enrichment (F2.13). Three stories are written by hand; any other covered story gets a coherent
 * draft built from its own text, so every path of the desk can be tried.
 */

const DATA_PANEL = 'Painel de Comércio Exterior';

function source(id: string, partial: Omit<ResearchSource, 'id' | 'state'> & { state?: ResearchSource['state'] }): ResearchSource {
  return { id, state: 'suggested', ...partial };
}

export function researchFor(news: NewsItem, clock: Clock, archive: readonly ArchiveArticle[]): ResearchSource[] {
  const at = clock.ago(0);
  if (news.id === FLAGSHIP_NEWS_ID) {
    return [
      source('s-tilapia-panel', { title: 'Exportações de pescado por espécie, julho a setembro de 2026', url: 'https://painelcomex.exemplo/pescado/2026-t3', outlet: DATA_PANEL, kind: 'data', publishedAt: clock.ago(2_900), consultedAt: at, excerpt: 'Tilápia (filés frescos e congelados): 4.112 toneladas no 3º trimestre de 2026, ante 2.980 toneladas no 3º trimestre de 2025. Receita: US$ 18,6 milhões (US$ 13,2 milhões em 2025).' }),
      source('s-tilapia-original', { title: news.title, url: news.url, outlet: news.source, kind: 'press', publishedAt: news.publishedAt, consultedAt: at, excerpt: 'A receita somou US$ 18,6 milhões, alta de 41%. O preço médio por quilo subiu de US$ 4,32 para US$ 4,54. Paraná e São Paulo responderam por 72% do volume.' }),
      source('s-tilapia-association', { title: 'Nota sobre o desempenho das exportações no trimestre', url: 'https://tilapicultores-pr.exemplo/notas/exportacoes-t3', outlet: 'Associação de Tilapicultores do Paraná', kind: 'association', publishedAt: clock.ago(600), consultedAt: at, excerpt: 'O Paraná respondeu sozinho por 58% do volume exportado. A associação atribui o resultado à rota cargueira semanal entre Curitiba e Miami, ativa desde maio.' }),
      source('s-tilapia-wire', { title: 'US fresh tilapia fillet imports from Brazil climb', url: 'https://seafoodwire.exemplo/us-tilapia-imports-brazil', outlet: 'Seafood Wire', kind: 'press', publishedAt: clock.ago(1_900), consultedAt: at, excerpt: 'Brazil supplied 11% of US fresh tilapia fillet imports in the quarter, up from 7% a year earlier, while Colombia kept the lead.' }),
      source('s-tilapia-archive', { title: 'Voo direto de Curitiba encurta caminho do filé fresco até Miami', url: archiveUrl(archive, 'a-air-routes'), outlet: 'Acervo do portal', kind: 'archive', publishedAt: clock.ago(95_000), consultedAt: at, excerpt: 'A rota cargueira semanal reduziu de 72 para 48 horas o tempo entre o abate e a gôndola nos Estados Unidos.' }),
      source('s-tilapia-blog', { title: 'Tilápia brasileira vai dominar o mundo?', url: 'https://peixefacil.exemplo/tilapia-dominar', outlet: 'Blog Peixe Fácil', kind: 'press', publishedAt: clock.ago(5_000), consultedAt: at, excerpt: 'Na nossa opinião, o Brasil será o maior exportador de tilápia do mundo em cinco anos.' }),
    ];
  }
  if (news.id === RESEARCH_NEWS_ID) {
    return [
      source('s-itajai-port', { title: 'Movimentação de setembro de 2026', url: 'https://portoitajai.exemplo/estatisticas/2026-09', outlet: 'Autoridade Portuária de Itajaí', kind: 'official', publishedAt: clock.ago(1_300), consultedAt: clock.ago(980), excerpt: 'Contêineres refrigerados (reefer): 38.214 unidades em setembro de 2026; 31.305 em setembro de 2025.', state: 'accepted' }),
      source('s-itajai-original', { title: news.title, url: news.url, outlet: news.source, kind: 'press', publishedAt: news.publishedAt, consultedAt: clock.ago(980), excerpt: 'Carnes e pescados respondem pela maior parte da carga.', state: 'accepted' }),
      source('s-itajai-panel', { title: 'Exportações de pescado por porto de embarque', url: 'https://painelcomex.exemplo/pescado/portos', outlet: DATA_PANEL, kind: 'data', publishedAt: clock.ago(2_900), consultedAt: clock.ago(980), excerpt: 'Itajaí embarcou 1.840 toneladas de pescado em setembro de 2026, 9% do total exportado pelo porto em cargas refrigeradas.' }),
      source('s-itajai-archive', { title: 'Falta de contêiner refrigerado atrasa embarques no Sul', url: archiveUrl(archive, 'a-reefer'), outlet: 'Acervo do portal', kind: 'archive', publishedAt: clock.ago(400_000), consultedAt: clock.ago(980), excerpt: 'Exportadores relataram esperas de até três semanas por contêineres refrigerados nos portos de Itajaí e Paranaguá.' }),
    ];
  }
  if (news.id === ARTICLE_NEWS_ID) {
    return [
      source('s-credit-bank', { title: 'Programa de crédito para a piscicultura: regulamento', url: 'https://bancofomentosul.exemplo/piscicultura/regulamento', outlet: 'Banco de Fomento do Sul', kind: 'official', publishedAt: clock.ago(1_600), consultedAt: clock.ago(1_250), excerpt: 'Valor total: R$ 400 milhões. Juros de 7% ao ano, carência de 24 meses e prazo de 8 anos. Receita bruta anual de até R$ 4,8 milhões. Pedidos a partir de 3/11/2026.', state: 'accepted' }),
      source('s-credit-original', { title: 'Banco de fomento abre linha de R$ 400 milhões para piscicultores', url: 'https://portalaquicola.exemplo/linha-credito-piscicultores', outlet: 'Portal Aquícola', kind: 'press', publishedAt: clock.ago(1_500), consultedAt: clock.ago(1_250), excerpt: 'O crédito financia tanques, aeradores e energia solar.', state: 'accepted' }),
      source('s-credit-archive', { title: 'Crédito rural para aquicultura cresce, mas não chega ao pequeno produtor', url: archiveUrl(archive, 'a-credit-2025'), outlet: 'Acervo do portal', kind: 'archive', publishedAt: clock.ago(260_000), consultedAt: clock.ago(1_250), excerpt: 'Só 14% do crédito destinado à aquicultura em 2025 foi para produtores com receita abaixo de R$ 1 milhão.', state: 'accepted' }),
      source('s-credit-energy', { title: 'Energia solar reduz em 30% a conta de luz de piscicultores', url: archiveUrl(archive, 'a-energy'), outlet: 'Acervo do portal', kind: 'archive', publishedAt: clock.ago(60_000), consultedAt: clock.ago(1_250), excerpt: 'Produtores trocaram parte do consumo de aeradores por energia solar e cortaram até 30% da conta.', state: 'accepted' }),
    ];
  }
  const related = archive.find((article) => sectionOf(news) === article.section);
  return [
    source(`s-${news.id}-original`, { title: news.title, url: news.url, outlet: news.source, kind: 'press', publishedAt: news.publishedAt, consultedAt: at, excerpt: news.body.join(' ') }),
    ...news.duplicates.map((duplicate, index) => source(`s-${news.id}-dup-${index}`, { title: news.title, url: duplicate.url, outlet: duplicate.source, kind: 'press', publishedAt: duplicate.publishedAt, consultedAt: at, excerpt: news.excerpt })),
    ...(related ? [source(`s-${news.id}-archive`, { title: related.title, url: related.url, outlet: 'Acervo do portal', kind: 'archive', publishedAt: related.publishedAt, consultedAt: at, excerpt: related.excerpt })] : []),
  ];
}

function archiveUrl(archive: readonly ArchiveArticle[], id: string): string {
  return archive.find((article) => article.id === id)?.url ?? 'https://portal-do-pescado.exemplo';
}

function sectionOf(news: NewsItem): string {
  const topic = news.classification?.topic ?? '';
  if (topic.startsWith('Exportação')) return 'Mercado';
  if (topic.startsWith('Indústria')) return 'Indústria';
  if (topic.startsWith('Sanidade')) return 'Regulação';
  return topic;
}

export function outlineFor(news: NewsItem, sources: readonly ResearchSource[]): HardNewsOutline {
  const ids = acceptedSources({ sources }).map((item) => item.id);
  if (news.id === FLAGSHIP_NEWS_ID) {
    return {
      headline: 'Exportações de tilápia crescem 38% no terceiro trimestre',
      lead: 'O Brasil exportou 4,1 mil toneladas de tilápia entre julho e setembro, 38% a mais que no mesmo período de 2025.',
      size: 'standard',
      keywords: ['exportação de tilápia', 'filé fresco', 'tilápia Paraná', 'comércio exterior pescado'],
      sections: [
        { id: 'o1', heading: 'Filé fresco puxa a alta', points: ['Receita de US$ 18,6 milhões, alta de 41%', 'Preço médio de US$ 4,54 por quilo', 'Rota cargueira Curitiba–Miami encurta o prazo para 48 horas'], sourceIds: ids.filter((id) => id !== 's-tilapia-association') },
        { id: 'o2', heading: 'Paraná concentra os embarques', points: ['Paraná e São Paulo somam 72% do volume', 'Brasil passa de 7% para 11% das importações americanas de filé fresco', 'Próxima atualização dos dados em novembro'], sourceIds: ids.filter((id) => id !== 's-tilapia-panel') },
      ],
    };
  }
  if (news.id === RESEARCH_NEWS_ID) {
    return {
      headline: 'Itajaí bate recorde de contêineres refrigerados em setembro',
      lead: 'O porto de Itajaí movimentou 38,2 mil contêineres refrigerados em setembro, 22% a mais que em 2025.',
      size: 'short',
      keywords: ['porto de Itajaí', 'contêiner refrigerado', 'exportação de pescado'],
      sections: [{ id: 'o1', heading: 'Quanto disso é pescado', points: ['1.840 toneladas de pescado embarcadas no mês', 'Gargalo de contêineres em 2025'], sourceIds: ids }],
    };
  }
  return {
    headline: news.title,
    lead: news.excerpt,
    size: news.body.length > 2 ? 'standard' : 'short',
    keywords: keywordsOf(news),
    sections: [
      { id: 'o1', heading: 'O que muda', points: news.body.slice(1, 3).map(shorten), sourceIds: ids.slice(0, 2) },
      { id: 'o2', heading: 'Contexto', points: [news.classification?.summary ?? 'Antecedentes no acervo do portal'], sourceIds: ids.slice(1) },
    ],
  };
}

/** Two or three search terms from the title and the topic, as suggestions. */
function keywordsOf(news: NewsItem): string[] {
  const stop = new Set(['para', 'pela', 'pelo', 'com', 'sobre', 'entre', 'mais', 'anuncia', 'abre', 'pede', 'pedem', 'testa', 'inaugura', 'prepara', 'revisam', 'começa']);
  const words = news.title.toLowerCase().replace(/[^a-zà-ú0-9 ]/g, ' ').split(/\s+/).filter((word) => word.length > 4 && !stop.has(word));
  const topic = news.classification?.topic.toLowerCase();
  return [...new Set([words.slice(0, 2).join(' '), words[2], topic].filter((entry): entry is string => Boolean(entry && entry.trim())))].slice(0, 3);
}

function shorten(text: string): string {
  const first = text.split(/(?<=\.)\s/)[0] ?? text;
  return first.length > 90 ? `${first.slice(0, 87).trimEnd()}…` : first.replace(/\.$/, '');
}

export type WrittenDraft = {
  body: ArticleBody;
  flags: EvidenceFlag[];
  suggestions: EnrichmentSuggestion[];
};

let blockSeq = 0;
const bid = (prefix: string) => `${prefix}-${(blockSeq += 1).toString(36)}`;

const ai = { ai: 'unreviewed' as const };
const p = (text: string | Inline[]) => paragraphBlock(bid('hn'), text, ai);
const h = (text: string) => headingBlock(bid('hn'), text, 2, ai);
const link = (text: string, href: string): Inline => ({ text, marks: ['link'], href });

/** The draft "Escrever artigo" produces: outline order, guide rules, sources linked inline. */
export function writeDraft(news: NewsItem, outline: HardNewsOutline, sources: readonly ResearchSource[], context: { quotes: readonly BankQuote[]; archive: readonly ArchiveArticle[] }): WrittenDraft {
  if (news.id === FLAGSHIP_NEWS_ID) return flagshipDraft(outline, sources, context);
  if (news.id === ARTICLE_NEWS_ID) return creditDraft(outline, context);
  return genericDraft(news, outline, sources, context);
}

function url(sources: readonly ResearchSource[], id: string): string {
  return sources.find((item) => item.id === id)?.url ?? '#';
}

function flagshipDraft(outline: HardNewsOutline, sources: readonly ResearchSource[], context: { quotes: readonly BankQuote[]; archive: readonly ArchiveArticle[] }): WrittenDraft {
  const archiveUrlOf = (id: string) => context.archive.find((article) => article.id === id)?.url ?? '#';
  const blocks: ArticleBlock[] = [
    p([{ text: 'O Brasil exportou 4,1 mil toneladas de tilápia entre julho e setembro, 38% a mais que no mesmo período de 2025, segundo dados do ' }, link('Painel de Comércio Exterior', url(sources, 's-tilapia-panel')), { text: '. Foi o maior volume trimestral da série histórica.' }]),
    p('A receita somou US$ 18,6 milhões, alta de 41% na mesma comparação. O preço médio por quilo subiu 8% e chegou a US$ 4,54, puxado pelos filés frescos, que valem mais que os congelados.'),
    p('Em volume, os embarques passaram de 2.980 toneladas no terceiro trimestre de 2025 para 4.112 toneladas neste ano. Em receita, de US$ 13,2 milhões para US$ 18,6 milhões.'),
    h(outline.sections[0]?.heading ?? 'Filé fresco puxa a alta'),
    p([{ text: 'Os Estados Unidos seguem como principal destino. Segundo a ' }, link('Seafood Wire', url(sources, 's-tilapia-wire')), { text: ', o Brasil passou de 7% para 11% das importações americanas de filé fresco de tilápia no trimestre. A Colômbia continua na liderança desse mercado.' }]),
    p('Exportadores atribuem o resultado à abertura de novas rotas aéreas e à demanda do varejo norte-americano por filé fresco.'),
    p([{ text: 'O prazo pesa porque o filé fresco tem validade curta. Desde maio, uma rota cargueira semanal liga Curitiba a Miami e ' }, link('reduziu de 72 para 48 horas', archiveUrlOf('a-air-routes')), { text: ' o tempo entre o abate e a gôndola nos Estados Unidos.' }]),
    h(outline.sections[1]?.heading ?? 'Paraná concentra os embarques'),
    p([{ text: 'Paraná e São Paulo responderam por 72% do volume embarcado. Só o Paraná somou 58%, de acordo com a ' }, link('Associação de Tilapicultores do Paraná', url(sources, 's-tilapia-association')), { text: ', que reúne produtores do oeste do estado.' }]),
    p([{ text: 'O estado concentra as cooperativas que mais investiram em frigoríficos de exportação. Elas respondem por ' }, link('sete em cada dez quilos de tilápia', archiveUrlOf('a-cooperative')), { text: ' produzidos no Paraná.' }]),
    quoteBlock(bid('hn'), '“Exportar deixou de ser excedente. Hoje a gente planeja o viveiro pensando no cliente lá fora”, disse Otávio Mendes, presidente da associação, em painel na Feira do Pescado, em agosto.', ai),
    p('A associação avalia que o crescimento deve se manter até o fim do ano, com a entrada em operação de novos frigoríficos na região de Toledo.'),
    p('Os dados de comércio exterior de outubro serão divulgados na primeira semana de novembro.'),
  ];
  const body: ArticleBody = { type: 'article', title: outline.headline, blocks, coverSlot: { subject: 'Filés de tilápia embalados para exportação em frigorífico do Paraná', suggestedCaption: 'Filés de tilápia prontos para embarque', orientation: 'landscape' } };
  const flags: EvidenceFlag[] = [
    { id: 'f-record', kind: 'unsupported', claim: 'Foi o maior volume trimestral da série histórica.', detail: 'Nenhuma fonte aceita fala em recorde. O painel compara só com 2025.', sourceId: 's-tilapia-panel', state: 'open' },
    { id: 'f-price', kind: 'number', claim: 'O preço médio por quilo subiu 8%', detail: 'A fonte informa alta de US$ 4,32 para US$ 4,54, ou seja, 5%.', sourceId: 's-tilapia-original', fix: 'O preço médio por quilo subiu 5%', state: 'open' },
    { id: 'f-exporters', kind: 'attribution', claim: 'Exportadores atribuem o resultado à abertura de novas rotas aéreas', detail: 'O texto não diz quem são os exportadores. A associação do Paraná diz isso com nome.', sourceId: 's-tilapia-association', fix: 'A Associação de Tilapicultores do Paraná atribui o resultado à abertura de novas rotas aéreas', state: 'open' },
    { id: 'f-forecast', kind: 'attribution', claim: 'A associação avalia que o crescimento deve se manter até o fim do ano', detail: 'A nota da associação não traz projeção para o fim do ano.', sourceId: 's-tilapia-association', state: 'open' },
  ];
  const marina = context.quotes.find((quote) => quote.id === 'q-marina');
  const semester = context.archive.find((article) => article.id === 'a-semester');
  const suggestions: EnrichmentSuggestion[] = [
    ...(marina ? [{
      id: 'e-q-marina', kind: 'quote' as const, text: marina.text, anchor: 'O prazo pesa porque o filé fresco tem validade curta.',
      why: marina.context, origin: { title: marina.sourceTitle, url: marina.sourceUrl, date: marina.recordedOn, author: `${marina.author}, ${marina.role}` }, state: 'pending' as const,
    }] : []),
    ...(semester ? [{
      id: 'e-a-semester', kind: 'link' as const, text: semester.title, anchor: 'Em volume, os embarques',
      why: semester.excerpt, origin: { title: semester.title, url: semester.url, date: semester.publishedAt.slice(0, 10), author: semester.author }, state: 'pending' as const,
    }] : []),
  ];
  return { body, flags, suggestions };
}

function creditDraft(outline: HardNewsOutline, context: { quotes: readonly BankQuote[]; archive: readonly ArchiveArticle[] }): WrittenDraft {
  const blocks: ArticleBlock[] = [
    paragraphBlock('cr-1', 'O Banco de Fomento do Sul abre em 3 de novembro uma linha de crédito de R$ 400 milhões para piscicultores. O dinheiro financia tanques, aeradores e sistemas de energia solar, com juros de 7% ao ano e dois anos de carência.'),
    paragraphBlock('cr-2', 'Podem pedir produtores com receita bruta anual de até R$ 4,8 milhões. O prazo de pagamento é de oito anos, contando a carência.'),
    headingBlock('cr-3', 'Energia pesa no custo'),
    paragraphBlock('cr-4', 'A energia dos aeradores é o segundo maior custo da produção, atrás da ração. Em reportagem de 2026, o portal mostrou que a troca por energia solar cortou até 30% da conta de luz de produtores de Minas Gerais e do Paraná.', ai),
    quoteBlock('cr-5', '“O crédito com carência de dois anos é o que permite trocar o aerador antes de o tanque dar retorno”, disse Sônia Barreto, gerente de agronegócio do banco.'),
    headingBlock('cr-6', 'Pequeno produtor'),
    paragraphBlock('cr-7', 'A linha tenta corrigir uma distorção antiga. Em 2025, só 14% do crédito para a aquicultura foi para produtores com receita abaixo de R$ 1 milhão.', ai),
    paragraphBlock('cr-8', 'O banco espera atender 2 mil produtores no primeiro ano.', ai),
  ];
  const body: ArticleBody = { type: 'article', title: outline.headline || 'Banco de fomento abre linha de R$ 400 milhões para piscicultores', blocks };
  const flags: EvidenceFlag[] = [
    { id: 'f-cr-goal', kind: 'unsupported', claim: 'O banco espera atender 2 mil produtores no primeiro ano.', detail: 'O regulamento não traz meta de atendimento.', sourceId: 's-credit-bank', state: 'open' },
    { id: 'f-cr-cost', kind: 'attribution', claim: 'A energia dos aeradores é o segundo maior custo da produção, atrás da ração.', detail: 'Afirmação sem fonte. Há uma fala no banco de citações que diz isso.', fix: 'A energia dos aeradores é o segundo maior custo da produção, atrás da ração, segundo a piscicultora Luana Ferraz.', state: 'open' },
    { id: 'f-cr-share', kind: 'number', claim: 'só 14% do crédito para a aquicultura', detail: 'Confere com a matéria do acervo de 2025.', sourceId: 's-credit-archive', state: 'confirmed', decidedBy: 'João', decidedAt: new Date(Date.now() - 50 * 60_000).toISOString() },
  ];
  const luana = context.quotes.find((quote) => quote.id === 'q-luana');
  const energy = context.archive.find((article) => article.id === 'a-energy');
  const credit = context.archive.find((article) => article.id === 'a-credit-2025');
  const suggestions: EnrichmentSuggestion[] = [
    ...(luana ? [{
      id: 'e-q-luana', kind: 'quote' as const, text: luana.text, anchor: 'Em reportagem de 2026, o portal mostrou',
      why: luana.context, origin: { title: luana.sourceTitle, url: luana.sourceUrl, date: luana.recordedOn, author: `${luana.author}, ${luana.role}` }, state: 'pending' as const,
    }] : []),
    ...(energy ? [{
      id: 'e-a-energy', kind: 'link' as const, text: energy.title, anchor: 'Em reportagem de 2026, o portal mostrou',
      why: energy.excerpt, origin: { title: energy.title, url: energy.url, date: energy.publishedAt.slice(0, 10), author: energy.author }, state: 'pending' as const,
    }] : []),
    ...(credit ? [{
      id: 'e-a-credit-2025', kind: 'link' as const, text: credit.title, anchor: 'distorção antiga',
      why: credit.excerpt, origin: { title: credit.title, url: credit.url, date: credit.publishedAt.slice(0, 10), author: credit.author }, state: 'pending' as const,
    }] : []),
  ];
  return { body, flags, suggestions };
}

function genericDraft(news: NewsItem, outline: HardNewsOutline, sources: readonly ResearchSource[], context: { quotes: readonly BankQuote[]; archive: readonly ArchiveArticle[] }): WrittenDraft {
  const original = sources.find((item) => item.kind === 'press');
  const archived = acceptedSources({ sources }).find((item) => item.kind === 'archive') ?? sources.find((item) => item.kind === 'archive');
  const blocks: ArticleBlock[] = [
    p(original ? [{ text: `${news.body[0] ?? news.excerpt.replace(/\.$/, '')}, segundo a ` }, link(original.outlet, original.url), { text: '.' }] : news.excerpt),
    ...news.body.slice(1).map((text) => p(text)),
    h(outline.sections[1]?.heading ?? 'Contexto'),
    ...(archived ? [p([{ text: `O tema já esteve no portal. Em “` }, link(archived.title, archived.url), { text: `”, a reportagem mostrou que ${lowerFirst(archived.excerpt)}` }])] : []),
    p('O movimento deve continuar nos próximos meses.'),
  ];
  const body: ArticleBody = { type: 'article', title: outline.headline, blocks };
  const flags: EvidenceFlag[] = [
    { id: `f-${news.id}-trend`, kind: 'unsupported', claim: 'O movimento deve continuar nos próximos meses.', detail: 'Projeção sem fonte. Nenhuma fonte aceita fala do futuro.', state: 'open' },
  ];
  return { body, flags, suggestions: suggestionsFor(news.classification?.topic ?? '', body, context) };
}

function lowerFirst(text: string): string {
  return text ? text[0].toLowerCase() + text.slice(1) : text;
}

function plainText(body: ArticleBody): string[] {
  return body.blocks.flatMap((block) => ('inlines' in block ? [block.inlines.map((inline) => inline.text).join('')] : []));
}

/** Quotes of the bank on the topic and archive articles to link (F2.13), each with its origin. */
function suggestionsFor(topic: string, body: ArticleBody, context: { quotes: readonly BankQuote[]; archive: readonly ArchiveArticle[] }): EnrichmentSuggestion[] {
  const paragraphs = plainText(body);
  const whole = paragraphs.join(' ').toLowerCase();
  const shared = (text: string) => text.toLowerCase().split(/[^a-zà-ú0-9]+/).filter((word) => word.length > 6 && whole.includes(word)).length;
  const anchorFor = (index: number) => {
    const text = paragraphs[Math.min(index, paragraphs.length - 1)] ?? '';
    return text.split(/(?<=\.)\s/)[0] ?? text;
  };
  const quotes = context.quotes
    .filter((quote) => quote.topic === topic && quote.verified && !whole.includes(quote.text.slice(0, 40).toLowerCase()) && shared(`${quote.text} ${quote.context}`) >= 1)
    .slice(0, 1);
  const linked = new Set(body.blocks.flatMap((block) => ('inlines' in block ? block.inlines.flatMap((inline) => (inline.href ? [inline.href] : [])) : [])));
  const links = context.archive
    .filter((article) => article.index === 'indexed' && !linked.has(article.url) && shared(`${article.title} ${article.excerpt}`) >= 2)
    .slice(0, 2);
  return [
    ...quotes.map<EnrichmentSuggestion>((quote) => ({
      id: `e-${quote.id}`, kind: 'quote', text: quote.text, anchor: anchorFor(1),
      why: quote.context, origin: { title: quote.sourceTitle, url: quote.sourceUrl, date: quote.recordedOn, author: `${quote.author}, ${quote.role}` }, state: 'pending',
    })),
    ...links.map<EnrichmentSuggestion>((article, index) => ({
      id: `e-${article.id}`, kind: 'link', text: article.title, anchor: keyPhrase(paragraphs, article, index),
      why: article.excerpt, origin: { title: article.title, url: article.url, date: article.publishedAt.slice(0, 10), author: article.author }, state: 'pending',
    })),
  ];
}

/** Words of the article that a link to `article` can sit on: a few words around one both share. */
function keyPhrase(paragraphs: readonly string[], article: ArchiveArticle, index: number): string {
  const words = `${article.title} ${article.excerpt}`.toLowerCase().split(/[^a-zà-ú0-9]+/).filter((word) => word.length > 6);
  for (const paragraph of paragraphs) {
    const lower = paragraph.toLowerCase();
    const word = words.find((candidate) => lower.includes(candidate));
    if (word) {
      const start = lower.indexOf(word);
      const before = paragraph.slice(0, start).split(' ').slice(-2).join(' ');
      const after = paragraph.slice(start + word.length).split(' ').slice(0, 2).join(' ');
      return `${before}${paragraph.slice(start, start + word.length)}${after}`.trim().replace(/[.,;:]$/, '');
    }
  }
  return (paragraphs[index + 1] ?? paragraphs[0] ?? '').split(' ').slice(0, 4).join(' ');
}
