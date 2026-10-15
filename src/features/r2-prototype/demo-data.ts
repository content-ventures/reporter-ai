/** Illustrative editorial data for the isolated R2 prototype. Never used by production ports. */
export type News = { id: string; title: string; source: string; url: string; topic: string; age: string; summary: string; score: number | null; status: 'inbox' | 'selected' | 'dismissed'; reason: string };
export const NEWS: News[] = [
  { id: 'cold-chain', title: 'Cooperativas testam rastreabilidade na cadeia do pescado', source: 'Agência do Setor · exemplo', url: 'https://agencia.example/noticias/rastreabilidade', topic: 'Indústria', age: 'Há 20 min', summary: 'Projeto-piloto acompanha a temperatura dos lotes entre o desembarque e a distribuição. A pauta pede confirmação de abrangência, custo e resultados.', score: 92, status: 'inbox', reason: 'Alta aderência ao mapa editorial, impacto na cadeia produtiva e espaço para apuração própria.' },
  { id: 'retail', title: 'Varejo prepara ações para ampliar o consumo de pescado', source: 'Varejo em Foco · exemplo', url: 'https://varejo.example/consumo', topic: 'Mercado', age: 'Há 45 min', summary: 'Redes discutem mudanças na exposição dos produtos e treinamento das equipes. Dados de vendas ainda não foram apresentados.', score: 86, status: 'inbox', reason: 'Tema relevante para compradores; falta evidência independente para sustentar projeções.' },
  { id: 'exports', title: 'Exportadores discutem novos protocolos de qualidade', source: 'Agência do Setor · exemplo', url: 'https://agencia.example/exportacoes', topic: 'Mercado', age: 'Há 1 h', summary: 'Encontro reúne empresas para discutir padrões e documentação. Confirmar quais exigências estão em vigor.', score: 78, status: 'selected', reason: 'Impacto comercial relevante. Diferenciar propostas de regras já aprovadas.' },
  { id: 'aquaculture', title: 'Pesquisa avalia alternativas de alimentação na aquicultura', source: 'Observatório Azul · exemplo', url: 'https://observatorio.example/pesquisa', topic: 'Aquicultura', age: 'Há 2 h', summary: 'Estudo experimental compara formulações de ração. Verificar método, amostra e limitações antes de noticiar os resultados.', score: null, status: 'inbox', reason: 'Aguardando classificação.' },
  { id: 'festival', title: 'Festival gastronômico anuncia programação regional', source: 'Varejo em Foco · exemplo', url: 'https://varejo.example/festival', topic: 'Consumo', age: 'Há 3 h', summary: 'Programação de evento local sem dados de mercado ou conexão direta com a cadeia produtiva.', score: 35, status: 'dismissed', reason: 'Baixa aderência ao recorte B2B do veículo.' },
];
export type Feed = { id: string; name: string; url: string; interval: string; state: 'active' | 'paused' | 'error' };
export const FEEDS: Feed[] = [
  { id: 'agency', name: 'Agência do Setor', url: 'https://agencia.example/rss', interval: '30', state: 'active' },
  { id: 'retail', name: 'Varejo em Foco', url: 'https://varejo.example/feed', interval: '60', state: 'active' },
  { id: 'blue', name: 'Observatório Azul', url: 'https://observatorio.example/rss', interval: '120', state: 'error' },
];
export const QUOTES = [
  { id: 'q1', text: 'A rastreabilidade precisa acompanhar o lote em cada transferência, e não apenas na saída da fábrica.', author: 'Marina Costa', role: 'Especialista em qualidade · personagem fictícia', topic: 'Indústria', source: 'Entrevista demonstrativa', locator: '03:12–03:28', context: 'Discussão sobre documentação e controle de temperatura.', date: '14/10/2026', verified: true },
  { id: 'q2', text: 'O treinamento da equipe é parte da experiência de compra do pescado.', author: 'Rafael Lima', role: 'Consultor de varejo · personagem fictício', topic: 'Mercado', source: 'Painel demonstrativo de varejo', locator: '12:40–12:52', context: 'Atendimento e esclarecimento de dúvidas no ponto de venda.', date: '12/10/2026', verified: true },
  { id: 'q3', text: 'Ainda precisamos ampliar a amostra antes de recomendar essa formulação.', author: 'Ana Ribeiro', role: 'Pesquisadora · personagem fictícia', topic: 'Aquicultura', source: 'Transcrição demonstrativa', locator: '08:02–08:17', context: 'Limitações de um estudo experimental sobre alimentação.', date: '10/10/2026', verified: false },
];
export const ARCHIVE = [
  { id: 'a1', title: 'Como a cadeia fria preserva a qualidade do pescado', topic: 'Indústria', date: '08/10/2026', url: 'https://portal.example/cadeia-fria', excerpt: 'Monitoramento de temperatura, registros por lote e responsabilidades em cada etapa da distribuição.', state: 'indexed' as const },
  { id: 'a2', title: 'Rastreabilidade: o que registrar em cada lote', topic: 'Indústria', date: '02/10/2026', url: 'https://portal.example/rastreabilidade', excerpt: 'Identificação de origem, movimentações e registros que permitem reconstruir o caminho do produto.', state: 'indexed' as const },
  { id: 'a3', title: 'Varejo especializado aproxima consumidor do pescado', topic: 'Mercado', date: '29/09/2026', url: 'https://portal.example/varejo', excerpt: 'Exposição, orientação de preparo e treinamento das equipes no ponto de venda.', state: 'error' as const },
];
export const IMAGES = [
  { id: 'i1', title: 'Processamento de pescado', src: '/samples/seafood-processing-sample.jpg', credit: 'Imagem demonstrativa · verificar autoria', license: 'Pendente de validação', allowed: false, origin: 'Acervo de demonstração', description: 'Linha de processamento de pescado.' },
  { id: 'i2', title: 'Redação e apuração', src: '/editorial/writing.jpg', credit: 'Acervo de demonstração', license: 'Uso apenas no protótipo', allowed: true, origin: 'Arquivo local', description: 'Caneta sobre anotações de trabalho.' },
  { id: 'i3', title: 'Produto no varejo', src: '/samples/cafe-em-graos.jpg', credit: 'Acervo de demonstração', license: 'Uso apenas no protótipo', allowed: true, origin: 'Arquivo local', description: 'Grãos de café; imagem ilustrativa de produto.' },
];
export const RESEARCH = [
  { id: 's1', title: 'Apresentação do projeto-piloto', publisher: 'Cooperativa Azul · exemplo', type: 'Fonte primária', url: 'https://cooperativa.example/projeto', excerpt: 'O projeto acompanha lotes em duas unidades durante a fase de avaliação. Os resultados serão apresentados após a conclusão do piloto.', reliable: true },
  { id: 's2', title: 'Guia de controle de temperatura', publisher: 'Instituto Técnico · exemplo', type: 'Referência técnica', url: 'https://instituto.example/guia', excerpt: 'O registro de temperatura deve permitir identificar desvios e associá-los ao lote e à etapa da cadeia.', reliable: true },
  { id: 's3', title: 'Tecnologia promete eliminar perdas', publisher: 'Blog do fornecedor · exemplo', type: 'Fonte comercial', url: 'https://fornecedor.example/post', excerpt: 'O fornecedor afirma eliminar todas as perdas, sem apresentar metodologia ou dados auditáveis.', reliable: false },
];
export const DEFAULT_OUTLINE = '1. O que está sendo testado e por quem\n2. Como o rastreamento acompanha os lotes\n3. Limitações do piloto e próximos passos';
export const DEMO_ARTICLE = 'Cooperativas testam rastreabilidade na cadeia do pescado\n\nA Cooperativa Azul iniciou um projeto-piloto para acompanhar lotes de pescado em duas unidades, segundo a apresentação do projeto [1]. A iniciativa está em avaliação e ainda não tem resultados consolidados.\n\nO rastreamento associa registros de temperatura ao lote e à etapa de distribuição. Um guia técnico consultado recomenda esse vínculo para identificar desvios e localizar sua origem [2].\n\nO fornecedor afirma que a tecnologia elimina todas as perdas.\n\nA próxima etapa é acompanhar os resultados do piloto e verificar seu alcance antes de ampliar a aplicação.';
export function validWebUrl(value: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}
export const matches = (query: string, ...parts: string[]) => parts.join(' ').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().includes(query.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim());
