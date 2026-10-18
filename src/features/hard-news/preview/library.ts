import type { ArchiveArticle, ArchiveImage, BankQuote, CmsConnection } from '@/domain/hard-news';
import { archiveCopy } from '../images/images-model.ts';
import type { BankProvider } from '../images/images-model.ts';
import { bankPhoto } from './image-bank.ts';
import type { Clock } from './news';

/** Preview data of the R2 library: quote bank, published archive, image archive and the CMS. */

export function seedQuotes(): BankQuote[] {
  return [
    { id: 'q-marina', text: 'O filé fresco só chega aos Estados Unidos em 48 horas porque hoje temos voo direto saindo de Curitiba e de Viracopos.', author: 'Marina Castro', role: 'diretora comercial da Cooperativa Oeste Peixes', topic: 'Exportação e mercado', origin: 'transcript', sourceTitle: 'Podcast Cadeia do Pescado #41', locator: '14:32', context: 'Explica por que o filé fresco ganhou espaço nas exportações.', recordedOn: '2026-09-18', verified: true, uses: 3 },
    { id: 'q-otavio', text: 'Exportar deixou de ser excedente. Hoje a gente planeja o viveiro pensando no cliente lá fora.', author: 'Otávio Mendes', role: 'presidente da Associação de Tilapicultores do Paraná', topic: 'Exportação e mercado', origin: 'event', sourceTitle: 'Painel de abertura da Feira do Pescado 2026', locator: '32:10', context: 'Fala sobre a mudança no planejamento dos produtores.', recordedOn: '2026-08-27', verified: true, uses: 1 },
    { id: 'q-luana', text: 'Sem energia mais barata, o aerador vira o maior custo da propriedade depois da ração.', author: 'Luana Ferraz', role: 'piscicultora em Morada Nova de Minas', topic: 'Aquicultura', origin: 'transcript', sourceTitle: 'Entrevista sobre custos de produção', locator: '06:48', context: 'Comenta o peso da energia no custo do produtor.', recordedOn: '2026-07-02', verified: true, uses: 2 },
    { id: 'q-henrique', text: 'O glaciamento precisa estar na frente da embalagem. O consumidor paga gelo achando que é peixe.', author: 'Henrique Salles', role: 'consultor de qualidade em pescado', topic: 'Sanidade e regulação', origin: 'article', sourceTitle: 'Entrevista publicada em 12/03/2026', sourceUrl: 'https://portal-do-pescado.exemplo/glaciamento-entrevista', locator: '4º parágrafo', context: 'Defende a rotulagem do percentual de gelo.', recordedOn: '2026-03-12', verified: true, uses: 4 },
    { id: 'q-beatriz', text: 'Rastreabilidade só funciona se a temperatura for registrada em cada troca de mão, não só na saída da fábrica.', author: 'Beatriz Nunes', role: 'pesquisadora de logística do frio', topic: 'Indústria e processamento', origin: 'event', sourceTitle: 'Seminário de logística refrigerada', locator: '41:05', context: 'Explica onde a cadeia perde controle de temperatura.', recordedOn: '2026-06-15', verified: true, uses: 0 },
    { id: 'q-raul', text: 'A gente perdeu metade dos viveiros para a mancha branca em agosto. O preço subiu, mas não tenho camarão para vender.', author: 'Raul Pinheiro', role: 'carcinicultor em Aracati (CE)', topic: 'Exportação e mercado', origin: 'transcript', sourceTitle: 'Entrevista sobre a safra de camarão', locator: '02:15', context: 'Relata o efeito da doença na oferta.', recordedOn: '2026-09-30', verified: false, uses: 0 },
    { id: 'q-sonia', text: 'O crédito com carência de dois anos é o que permite trocar o aerador antes de o tanque dar retorno.', author: 'Sônia Barreto', role: 'gerente de agronegócio do Banco de Fomento do Sul', topic: 'Aquicultura', origin: 'transcript', sourceTitle: 'Entrevista sobre a nova linha de crédito', locator: '09:21', context: 'Explica por que a carência foi definida em dois anos.', recordedOn: '2026-10-15', verified: true, uses: 1 },
    { id: 'q-tadeu', text: 'Quem trabalha com salmão já sente o reajuste no pedido de dezembro.', author: 'Tadeu Lins', role: 'importador em São Paulo', topic: 'Exportação e mercado', origin: 'article', sourceTitle: 'Matéria de 02/10/2026', sourceUrl: 'https://portal-do-pescado.exemplo/salmao-reajuste', locator: '6º parágrafo', context: 'Comenta o impacto da oferta chilena no preço.', recordedOn: '2026-10-02', verified: true, uses: 2 },
    { id: 'q-celia', text: 'Cada contêiner parado no porto custa ao exportador o equivalente a dois dias de produção da planta.', author: 'Célia Moura', role: 'gerente de exportação de um frigorífico em Toledo (PR)', topic: 'Exportação e mercado', origin: 'transcript', sourceTitle: 'Entrevista sobre contêineres refrigerados', locator: '11:40', context: 'Explica o custo da espera por contêiner refrigerado.', recordedOn: '2026-10-08', verified: true, uses: 1 },
    { id: 'q-ivan', text: 'O pirarucu de manejo vale mais quando a comunidade controla a contagem. O selo só existe por causa disso.', author: 'Ivan Batista', role: 'coordenador de manejo comunitário no Médio Juruá', topic: 'Pesca', origin: 'event', sourceTitle: 'Fórum Amazônico de Pesca', locator: '18:22', context: 'Defende a contagem feita pelos pescadores.', recordedOn: '2026-09-05', verified: true, uses: 0 },
    { id: 'q-patricia', text: 'A rotulagem precisa dizer o peso líquido sem gelo. É o mínimo para o consumidor comparar preço.', author: 'Patrícia Lemos', role: 'diretora de defesa do consumidor do Instituto Mesa Justa', topic: 'Sanidade e regulação', origin: 'article', sourceTitle: 'Artigo de opinião de 20/09/2026', context: 'Comenta a consulta pública sobre rotulagem.', recordedOn: '2026-09-20', verified: true, uses: 2 },
    { id: 'q-gilberto', text: 'Ração é 70% do custo. Se a farinha de peixe sobe, o produtor sente no mês seguinte.', author: 'Gilberto Ramos', role: 'zootecnista e consultor em nutrição de peixes', topic: 'Aquicultura', origin: 'transcript', sourceTitle: 'Podcast Cadeia do Pescado #44', locator: '22:05', context: 'Explica o efeito do preço da farinha de peixe.', recordedOn: '2026-10-11', verified: true, uses: 1 },
    { id: 'q-amanda', text: 'Nosso cliente americano pede rastreio do lote do viveiro até a gôndola. Sem isso, não há contrato.', author: 'Amanda Teles', role: 'responsável por qualidade em uma exportadora de tilápia', topic: 'Exportação e mercado', origin: 'transcript', sourceTitle: 'Entrevista sobre exigências do importador', locator: '07:58', context: 'Descreve o que o comprador exige.', recordedOn: '2026-09-26', verified: false, uses: 0 },
    { id: 'q-jorge', text: 'A tainha voltou a aparecer em cardume grande depois de três safras fracas. O defeso está funcionando.', author: 'Jorge Medeiros', role: 'presidente da colônia de pescadores de Laguna (SC)', topic: 'Pesca', origin: 'transcript', sourceTitle: 'Entrevista sobre a safra da tainha', locator: '03:30', context: 'Avalia o efeito do defeso.', recordedOn: '2026-07-21', verified: true, uses: 2 },
    { id: 'q-renata', text: 'O mexilhão catarinense tem demanda para crescer, mas falta área licenciada no mar.', author: 'Renata Vieira', role: 'pesquisadora de maricultura', topic: 'Aquicultura', origin: 'event', sourceTitle: 'Seminário Catarinense de Maricultura', locator: '26:14', context: 'Aponta o gargalo do licenciamento.', recordedOn: '2026-08-12', verified: true, uses: 0 },
    { id: 'q-marcos', text: 'Quando o Chile tem surto, o preço aqui sobe em duas semanas. Não existe estoque regulador de salmão.', author: 'Marcos Aguiar', role: 'importador em São Paulo', topic: 'Exportação e mercado', origin: 'transcript', sourceTitle: 'Entrevista sobre o mercado de salmão', locator: '05:47', context: 'Explica a dependência do salmão chileno.', recordedOn: '2026-10-14', verified: false, uses: 0 },
    { id: 'q-elisa', text: 'Inspeção laboratorial em todo lote importado vai atrasar a liberação, mas protege o produtor nacional.', author: 'Elisa Prado', role: 'auditora fiscal federal agropecuária', topic: 'Sanidade e regulação', origin: 'event', sourceTitle: 'Audiência pública sobre pescado importado', locator: '44:02', context: 'Comenta a mudança na inspeção.', recordedOn: '2026-10-16', verified: true, uses: 0 },
    { id: 'q-thiago', text: 'A cooperativa só fechou o contrato com o varejo depois que padronizou o filé em 120 gramas.', author: 'Thiago Rezende', role: 'gerente comercial da Cooperativa Lago Azul', topic: 'Varejo e consumo', origin: 'transcript', sourceTitle: 'Entrevista sobre padronização de produto', locator: '13:10', context: 'Explica a exigência do varejo.', recordedOn: '2026-06-28', verified: true, uses: 3 },
    { id: 'q-fernanda', text: 'Painel solar flutuante reduz a evaporação e ainda baixa a temperatura da água no verão.', author: 'Fernanda Lopes', role: 'engenheira de energia renovável', topic: 'Aquicultura', origin: 'article', sourceTitle: 'Matéria de 05/09/2026', locator: '3º parágrafo', context: 'Explica o ganho duplo da usina flutuante.', recordedOn: '2026-09-05', verified: true, uses: 1 },
    { id: 'q-antonio', text: 'O camarão que vai para a China precisa sair congelado em até quatro horas depois da despesca.', author: 'Antônio Queiroz', role: 'diretor técnico de uma fazenda de camarão em Mossoró (RN)', topic: 'Exportação e mercado', origin: 'transcript', sourceTitle: 'Entrevista sobre a habilitação chinesa', locator: '09:36', context: 'Descreve a exigência de tempo de congelamento.', recordedOn: '2026-10-10', verified: false, uses: 0 },
    { id: 'q-claudia', text: 'Peixe às sextas é hábito antigo. A campanha só funciona se o preço da gôndola acompanhar.', author: 'Cláudia Nogueira', role: 'diretora de compras de uma rede de supermercados', topic: 'Varejo e consumo', origin: 'event', sourceTitle: 'Encontro do Varejo Alimentar', locator: '15:50', context: 'Comenta a campanha de consumo.', recordedOn: '2026-09-30', verified: true, uses: 0 },
    { id: 'q-ricardo', text: 'Draga parada em Rio Grande significa navio frigorífico saindo com meia carga.', author: 'Ricardo Fontes', role: 'presidente do sindicato dos exportadores gaúchos', topic: 'Logística', origin: 'transcript', sourceTitle: 'Entrevista sobre a dragagem do porto', locator: '04:18', context: 'Explica o efeito do atraso da obra.', recordedOn: '2026-10-13', verified: true, uses: 1 },
    { id: 'q-lucia', text: 'A farinha de inseto já entra em 15% da ração de tambaqui sem perda de crescimento.', author: 'Lúcia Andrade', role: 'pesquisadora de nutrição aquícola', topic: 'Aquicultura', origin: 'article', sourceTitle: 'Artigo técnico de 18/08/2026', locator: 'Tabela 2', context: 'Apresenta o resultado do teste com ração.', recordedOn: '2026-08-18', verified: true, uses: 0 },
    { id: 'q-paulo', text: 'A feira de Toledo virou a vitrine da tilápia para o comprador estrangeiro.', author: 'Paulo Henrique Duarte', role: 'organizador da feira de aquicultura de Toledo', topic: 'Aquicultura', origin: 'event', sourceTitle: 'Lançamento da feira 2027', locator: '02:44', context: 'Fala sobre o público internacional da feira.', recordedOn: '2026-10-17', verified: false, uses: 0 },
    { id: 'q-sergio', text: 'Lagosta com cota menor e preço maior não fecha a conta do pescador artesanal.', author: 'Sérgio Cavalcante', role: 'pescador e líder comunitário em Icapuí (CE)', topic: 'Pesca', origin: 'transcript', sourceTitle: 'Entrevista sobre a cota da lagosta', locator: '08:09', context: 'Comenta o pedido de revisão da cota.', recordedOn: '2026-10-01', verified: true, uses: 1 },
    { id: 'q-vera', text: 'Cada grau acima da faixa no transporte tira um dia de prateleira do pescado fresco.', author: 'Vera Albuquerque', role: 'professora de tecnologia de alimentos', topic: 'Indústria e processamento', origin: 'event', sourceTitle: 'Seminário de logística refrigerada', locator: '29:37', context: 'Explica a perda de vida útil.', recordedOn: '2026-06-15', verified: true, uses: 2 },
  ];
}

export function seedArchive(clock: Clock): ArchiveArticle[] {
  return [
    { id: 'a-semester', title: 'Exportação de pescado fecha semestre com alta de 19%', url: 'https://portal-do-pescado.exemplo/exportacao-semestre', section: 'Mercado', publishedAt: clock.ago(140_000), author: 'Clara Souto', excerpt: 'As vendas externas de pescado somaram US$ 32 milhões no primeiro semestre. A tilápia respondeu por 61% da receita, com os Estados Unidos como principal destino.', index: 'indexed' },
    { id: 'a-air-routes', title: 'Voo direto de Curitiba encurta caminho do filé fresco até Miami', url: 'https://portal-do-pescado.exemplo/voo-direto-curitiba', section: 'Mercado', publishedAt: clock.ago(95_000), author: 'Rafael Dias', excerpt: 'A rota cargueira semanal reduziu de 72 para 48 horas o tempo entre o abate e a gôndola nos Estados Unidos, segundo exportadores do oeste do Paraná.', index: 'indexed' },
    { id: 'a-glazing', title: 'Glaciamento acima do limite é a infração mais comum em pescado congelado', url: 'https://portal-do-pescado.exemplo/glaciamento-infracao', section: 'Regulação', publishedAt: clock.ago(310_000), author: 'Juliana Prates', excerpt: 'Fiscalizações encontraram excesso de gelo em 38% das amostras de filé congelado analisadas no último ano.', index: 'indexed' },
    { id: 'a-energy', title: 'Energia solar reduz em 30% a conta de luz de piscicultores', url: 'https://portal-do-pescado.exemplo/energia-solar-piscicultura', section: 'Aquicultura', publishedAt: clock.ago(60_000), author: 'João', excerpt: 'Produtores de Minas Gerais e do Paraná trocaram parte do consumo de aeradores por energia solar e cortaram até 30% da conta.', index: 'indexed' },
    { id: 'a-cooperative', title: 'Cooperativas concentram 70% da tilápia do Paraná', url: 'https://portal-do-pescado.exemplo/cooperativas-tilapia-parana', section: 'Indústria', publishedAt: clock.ago(200_000), author: 'Clara Souto', excerpt: 'O modelo cooperativo responde por sete em cada dez quilos de tilápia produzidos no estado, segundo levantamento da associação dos produtores.', index: 'indexed' },
    { id: 'a-reefer', title: 'Falta de contêiner refrigerado atrasa embarques no Sul', url: 'https://portal-do-pescado.exemplo/conteiner-refrigerado-falta', section: 'Logística', publishedAt: clock.ago(400_000), author: 'Rafael Dias', excerpt: 'Exportadores relataram esperas de até três semanas por contêineres refrigerados nos portos de Itajaí e Paranaguá.', index: 'indexed' },
    { id: 'a-white-spot', title: 'Mancha branca volta a atingir viveiros no Ceará', url: 'https://portal-do-pescado.exemplo/mancha-branca-ceara', section: 'Aquicultura', publishedAt: clock.ago(50_000), author: 'Juliana Prates', excerpt: 'Produtores de Aracati e Jaguaruana relatam perdas de até metade da produção em viveiros sem biossegurança.', index: 'indexed' },
    { id: 'a-credit-2025', title: 'Crédito rural para aquicultura cresce, mas não chega ao pequeno produtor', url: 'https://portal-do-pescado.exemplo/credito-aquicultura-pequeno', section: 'Aquicultura', publishedAt: clock.ago(260_000), author: 'João', excerpt: 'Só 14% do crédito destinado à aquicultura em 2025 foi para produtores com receita abaixo de R$ 1 milhão.', index: 'indexed' },
    { id: 'a-salmon', title: 'Importadores repassam alta do salmão chileno ao varejo', url: 'https://portal-do-pescado.exemplo/salmao-reajuste', section: 'Mercado', publishedAt: clock.ago(20_000), author: 'Rafael Dias', excerpt: 'O quilo do salmão inteiro subiu 9% em setembro para o varejo paulista.', index: 'indexed' },
    { id: 'a-traceability', title: 'Rastreabilidade do pescado avança com sensores de temperatura', url: 'https://portal-do-pescado.exemplo/rastreabilidade-sensores', section: 'Indústria', publishedAt: clock.ago(120_000), author: 'Clara Souto', excerpt: 'Projetos-piloto registram a temperatura do lote em cada transferência, do desembarque ao varejo.', index: 'pending' },
    { id: 'a-fair', title: 'Feira do Pescado 2026 reúne 400 expositores em São Paulo', url: 'https://portal-do-pescado.exemplo/feira-pescado-2026', section: 'Eventos', publishedAt: clock.ago(72_000), author: 'Juliana Prates', excerpt: 'O evento teve recorde de compradores internacionais e rodadas de negócios com 18 países.', index: 'failed' },
    { id: 'a-shrimp-price', title: 'Preço do camarão sobe 18% com a mancha branca no Nordeste', url: 'https://portal-do-pescado.exemplo/camarao-preco-mancha-branca', section: 'Mercado', publishedAt: clock.ago(30_000), author: 'Juliana Prates', excerpt: 'O quilo do camarão cinza médio passou de R$ 39 para R$ 46 nas centrais de abastecimento em três semanas, com a oferta menor dos viveiros do Ceará.', index: 'indexed' },
    { id: 'a-us-fillet', title: 'Estados Unidos já compram metade do filé fresco de tilápia exportado', url: 'https://portal-do-pescado.exemplo/eua-file-fresco-tilapia', section: 'Mercado', publishedAt: clock.ago(230_000), author: 'Clara Souto', excerpt: 'O mercado norte-americano respondeu por 52% do filé fresco embarcado no primeiro trimestre, puxado pelo varejo de Miami e Nova York.', index: 'indexed' },
    { id: 'a-feed', title: 'Ração representa 70% do custo da tilápia, mostra levantamento', url: 'https://portal-do-pescado.exemplo/racao-custo-tilapia', section: 'Aquicultura', publishedAt: clock.ago(160_000), author: 'João', excerpt: 'A ração responde por sete de cada dez reais gastos para produzir um quilo de tilápia, segundo levantamento com 120 piscicultores.', index: 'indexed' },
    { id: 'a-sardine', title: 'Pesca da sardinha volta a crescer depois de dois anos de queda', url: 'https://portal-do-pescado.exemplo/sardinha-pesca-retomada', section: 'Pesca', publishedAt: clock.ago(330_000), author: 'Rafael Dias', excerpt: 'Os desembarques de sardinha-verdadeira em Santa Catarina somaram 62 mil toneladas, alta de 14% sobre a safra anterior.', index: 'indexed' },
    { id: 'a-sif', title: 'Novas regras do SIF exigem rastreio de lote em pescado congelado', url: 'https://portal-do-pescado.exemplo/sif-rastreio-lote-congelado', section: 'Regulação', publishedAt: clock.ago(350_000), author: 'Juliana Prates', excerpt: 'Frigoríficos com inspeção federal terão de registrar o lote de origem de cada caixa de pescado congelado a partir de julho.', index: 'indexed' },
  ];
}

const SEAFOOD_PHOTO = '/samples/seafood-processing-sample.jpg';

/** A photo the desk already saved from a bank (preview): the bank's photo with the archive's own record. */
function saved(id: string, provider: BankProvider, providerId: string, record: Partial<Pick<ArchiveImage, 'credit' | 'license' | 'uses'>>): ArchiveImage[] {
  const photo = bankPhoto(provider, providerId);
  return photo ? [{ ...archiveCopy(photo, id), ...record }] : [];
}

/**
 * The portal's archive, last saved first: its own photo and photos saved from the banks. Two show
 * REQ-2.9: one with rights to confirm and one without credit, so neither can go into an article.
 */
export function seedImages(): ArchiveImage[] {
  return [
    ...saved('img-tilapia-cesto', 'pexels', '31636077', { uses: 3 }),
    ...saved('img-salmao-tanques', 'pexels', '18511573', { license: 'pending' }),
    { id: 'img-processing', src: SEAFOOD_PHOTO, width: 1200, height: 1500, caption: 'Inspeção de peixe inteiro em bancada de processamento', credit: 'Acervo do portal', license: 'own', tags: ['indústria', 'processamento', 'qualidade'], takenOn: '2026-10-13', uses: 2, color: 'cinza' },
    ...saved('img-camarao-belem', 'pexels', '25014833', { uses: 1 }),
    ...saved('img-salmao-peixaria', 'unsplash', '2p76q_wVZF4', { credit: '' }),
    ...saved('img-tanques-rede-mar', 'unsplash', 'pTabFJI2hK8', { uses: 2 }),
    ...saved('img-porto-conteineres', 'unsplash', 'sWOvgOOFk1g', { uses: 4 }),
    ...saved('img-processamento-sagres', 'unsplash', 'DAJ4pKrRnzI', { uses: 1 }),
    ...saved('img-moqueca', 'pexels', '34130782', {}),
    ...saved('img-barco-paraty', 'unsplash', 'rZhKZDyEWt4', { uses: 2 }),
  ];
}

export function seedCms(clock: Clock): CmsConnection {
  return {
    platform: 'WordPress',
    siteUrl: 'https://portal-do-pescado.exemplo',
    account: 'reporter-ia',
    status: 'connected',
    checkedAt: clock.ago(35),
    mode: 'draft',
    categories: [
      { id: 'mercado', label: 'Mercado' },
      { id: 'aquicultura', label: 'Aquicultura' },
      { id: 'industria', label: 'Indústria' },
      { id: 'regulacao', label: 'Regulação' },
      { id: 'pesca', label: 'Pesca' },
      { id: 'logistica', label: 'Logística' },
    ],
    authors: [
      { id: 'wp-redacao', label: 'Redação' },
      { id: 'wp-joao', label: 'João' },
      { id: 'wp-clara', label: 'Clara Souto' },
      { id: 'wp-rafael', label: 'Rafael Dias' },
    ],
    authorMap: { João: 'wp-joao', 'Clara Souto': 'wp-clara', 'Rafael Dias': 'wp-rafael' },
    requires: { category: true, image: false, excerpt: true },
  };
}
