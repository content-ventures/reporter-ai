/** Seafood newsroom clipping specification. The domain exclusion applies to every newsroom. */
export const CLIPPING_BLOCKED_DOMAIN = 'seafoodbrasil.com.br';
export type ClippingLanguage = 'pt' | 'en' | 'es';
export const CLIPPING_WINDOWS = [
  { value: 24, label: '24 horas' }, { value: 48, label: '48 horas' }, { value: 72, label: '72 horas' },
  { value: 168, label: '7 dias' }, { value: 720, label: '30 dias' }, { value: 8760, label: '1 ano' },
] as const;
export type ClippingWindow = typeof CLIPPING_WINDOWS[number]['value'];
export const CLIPPING_SEGMENTS = [
  { id: 'aquaculture', label: 'Aquicultura', words: {
    pt: 'aquicultura|piscicultura|carcinicultura|maricultura|tilápia|tambaqui|pirarucu|pangasius|camarão|salmão|truta|ostras|mexilhões|algas|aquafeed|ração para peixe',
    en: 'aquaculture|fish farming|shrimp farming|tilapia|shrimp|salmon farming|aquafeed|fish feed',
    es: 'acuicultura|piscicultura|camaronicultura|tilapia|camarón|salmón|pienso acuícola',
  } },
  { id: 'fishing', label: 'Pesca', words: {
    pt: 'pesca industrial|pesca artesanal|captura de pescado|cotas de pesca|safra da tainha|sardinha|atum|bonito-listrado|polvo|lula|embarcações pesqueiras',
    en: 'fisheries|commercial fishing|fishing industry|tuna|sardine|squid|octopus|skipjack|fish catch|fishing quota',
    es: 'pesca industrial|pesca artesanal|capturas|cuotas pesqueras|atún|sardina|calamar|pulpo',
  } },
  { id: 'industry', label: 'Indústria', words: {
    pt: 'frigorífico de peixe|frigorífico de pescado|indústria de pescado|processamento de pescado|beneficiamento de pescado|cadeia de frio|habilitação de plantas|capacidade produtiva|fusões e aquisições pescado',
    en: 'seafood processing|seafood industry|fish processing|processing plant|seafood company|cold chain seafood|seafood mergers',
    es: 'procesamiento de pescado|industria pesquera|plantas procesadoras|cadena de frío',
  } },
  { id: 'retail', label: 'Varejo', words: {
    pt: 'peixaria|supermercado peixe|supermercado pescado|varejo alimentar pescado|venda de peixe|consumo de pescado|preço do peixe|gôndola pescado',
    en: 'seafood retail|supermarket seafood|fish retail|seafood sales|seafood consumption',
    es: 'pescadería|supermercado pescado|venta de pescado|consumo de pescado',
  } },
  { id: 'food-service', label: 'Food Service', words: {
    pt: 'food service pescado|restaurante peixe|restaurante frutos do mar|restaurante japonês|sushi redes|alimentação coletiva pescado|distribuidor de pescado food service',
    en: 'seafood restaurant|sushi restaurant|foodservice seafood|seafood menu trends',
    es: 'restaurante mariscos|restaurante sushi|foodservice pescado',
  } },
  { id: 'institutional', label: 'Institucional e Regulatório', words: {
    pt: 'Ministério da Pesca e Aquicultura|MPA pescado|MAPA pescado|Ibama defeso|Anvisa pescado|portaria pescado|licença ambiental aquicultura|tarifa antidumping pescado|inspeção sanitária pescado',
    en: 'FAO fisheries|fish trade tariffs|IUU fishing regulations|seafood sanitary ban|aquaculture policy',
    es: 'normativa pesquera|política acuícola|sanidad pesquera|aranceles pesca',
  } },
] as const;
export type ClippingSegment = typeof CLIPPING_SEGMENTS[number]['id'];

const AXES: Record<ClippingLanguage, string[]> = {
  pt: ['exportação|importação|tarifa|embargo|antidumping|habilitação de mercado|Mercosul|União Europeia|China|EUA',
    'mortalidade|surto|vacinação|inspeção sanitária|segurança alimentar|recall|genética',
    'preço|cotação|oferta e demanda|custos de produção|investimento|M&A|aquisição|joint venture',
    'rastreabilidade|certificação|pesca ilegal|IUU|licenciamento|ESG|bem-estar animal'],
  en: ['export|import|tariff|embargo|antidumping|market access|Mercosur|European Union|China|USA',
    'mortality|outbreak|vaccination|sanitary inspection|food safety|recall|genetics',
    'price|quotation|supply and demand|production costs|investment|M&A|acquisition|joint venture',
    'traceability|certification|illegal fishing|IUU|licensing|ESG|animal welfare'],
  es: ['exportación|importación|arancel|embargo|antidumping|acceso al mercado|Mercosur|Unión Europea|China|EEUU',
    'mortalidad|brote|vacunación|inspección sanitaria|seguridad alimentaria|retiro de producto|genética',
    'precio|cotización|oferta y demanda|costos de producción|inversión|M&A|adquisición|joint venture',
    'trazabilidad|certificación|pesca ilegal|IUU|licencia|ESG|bienestar animal'],
};

// Short queries let the source list do the targeting. Open searches add the business axes below.
const EDITORIAL_QUERIES: Record<ClippingSegment, Record<ClippingLanguage, string>> = {
  aquaculture: {
    pt: 'notícias aquicultura piscicultura tilápia',
    en: 'aquaculture salmon farming news',
    es: 'noticias acuicultura salmonicultura',
  },
  fishing: {
    pt: 'notícias pesca comercial cotas de pesca',
    en: 'commercial fishing quotas news',
    es: 'noticias pesca comercial cuotas pesqueras',
  },
  industry: {
    pt: 'notícias indústria processamento de pescado',
    en: 'seafood industry fish processing news',
    es: 'noticias industria procesamiento de pescado',
  },
  retail: {
    pt: 'notícias varejo de pescado supermercados',
    en: 'seafood retail supermarket sales news',
    es: 'noticias venta de pescado supermercados',
  },
  'food-service': {
    pt: 'notícias food service pescado restaurantes',
    en: 'seafood restaurant foodservice news',
    es: 'noticias restaurantes mariscos distribución',
  },
  institutional: {
    pt: 'notícias regulação pesca aquicultura licenças',
    en: 'fisheries aquaculture policy regulation news',
    es: 'noticias normativa pesquera acuícola',
  },
};

const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim();
const languages = ['pt', 'en', 'es'] as const;
const context = /\b(pesc\w*|fish\w*|seafood|aquicultur\w*|aquacultur\w*|acuicultur\w*|camarao|camaron|shrimp|tilapia|salmon|sardinha|sardine|sardina|atum|atun|tuna|squid|calamar|octopus|pulpo|mariscos|aquafeed)\b/;
const ambiguousTerms = new Set(['lula', 'algas', 'capturas', 'processing plant', 'cadena de frio', 'cadeia de frio', 'habilitacao de plantas', 'capacidade produtiva', 'restaurante japones', 'sushi redes', 'sushi restaurant', 'restaurante sushi']);
const excluded = /\b(receitas?|receita culinaria|culinaria caseira|pesca esportiva|dicas de fim de semana|curiosidades marinhas|publieditorial|santos f c|santos fc|santos futebol clubes?|santos futebol club|recipes?|home cooking|sport fishing|recreational fishing|weekend tips|marine curiosities|advertorial|recetas?|cocina casera|pesca deportiva|planes de fin de semana|curiosidades marinas|publirreportaje)\b/;
const subjectText = (value: string) => normalize(value).replace(/\b(de|do|da|das|dos|del|para|por|for|of|the|la|el|em|en)\b/g, ' ').replace(/ +/g, ' ').trim();
const ambiguous = new Set([...ambiguousTerms].map(subjectText));
const dictionary = CLIPPING_SEGMENTS.map(segment => ({
  id: segment.id, terms: [...new Set(languages.flatMap(language => segment.words[language].split('|').map(subjectText)))],
}));

export function clippingBlocked(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.+$/, '');
    return host === CLIPPING_BLOCKED_DOMAIN || host.endsWith(`.${CLIPPING_BLOCKED_DOMAIN}`);
  } catch { return false; }
}

export function clippingExcludedText(title: string, summary = ''): boolean {
  const text = normalize(`${title} ${summary}`);
  // Receita can mean revenue. Keep that economic usage.
  const withoutRevenue = text.replace(/\breceitas? (liquidas?|brutas?|operacionais?|tributarias?|financeiras?|de exportacao|da empresa|do setor|cresce\w*|sobe\w*|cai\w*|atinge\w*)\b/g, '');
  return excluded.test(withoutRevenue) || /\bpeixe\b/.test(text) && /\b(santos|paulistao|brasileirao)\b/.test(text) && /\b(gol|gols|futebol|atacante|torcida|elenco|tecnico|paulistao|brasileirao)\b/.test(text);
}

export function clippingSegment(title: string, excerpt = '', body: readonly string[] = []): ClippingSegment | undefined {
  const headline = ` ${subjectText(title)} `;
  const lead = ` ${subjectText(excerpt)} `;
  const article = ` ${subjectText(body.join(' '))} `;
  const grounded = context.test(headline + lead + article);
  let best: ClippingSegment | undefined;
  let highest = 0;
  for (const { id, terms } of dictionary) {
    let score = 0;
    for (const term of terms) {
      if (ambiguous.has(term) && !grounded) continue;
      // Space delimiters avoid turning “Lula” into a hit in an unrelated longer word.
      const phrase = ` ${term} `;
      const hit = (text: string) => text.includes(phrase) || text.includes(` ${term}s `);
      if (!hit(headline) && !hit(lead) && !hit(article)) continue;
      const weight = term.includes(' ') ? 4 : 1;
      score += weight * (hit(headline) ? 5 : hit(lead) ? 3 : 1);
    }
    if (score > highest) { best = id; highest = score; }
  }
  return best;
}

export function seafoodClippingQuery(index: number) {
  const pair = Math.floor(index / 2);
  const language = languages[pair % languages.length];
  const segmentIndex = Math.floor(pair / languages.length) % CLIPPING_SEGMENTS.length;
  const segment = CLIPPING_SEGMENTS[segmentIndex];
  if (index % 2) return { query: EDITORIAL_QUERIES[segment.id][language], language, mode: 'news', segment: segment.id } as const;
  const subjects = segment.words[language].split('|').filter(word => !ambiguous.has(subjectText(word))).slice(0, 3);
  const business = AXES[language].map(axis => {
    const terms = axis.split('|');
    return terms[segmentIndex % terms.length];
  });
  return { query: `${subjects.join(', ')}: ${business.join(', ')}`, language, mode: 'general' } as const;
}

export function clippingDateMatches(publishedAt: string, now: number, hours: ClippingWindow): boolean {
  const date = Date.parse(publishedAt);
  return date <= now && date >= now - hours * 3_600_000;
}
