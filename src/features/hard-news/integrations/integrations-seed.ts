import type { ActivityEntry, IntegrationsState, WebhookDelivery } from './integrations-model.ts';

/**
 * The example newsroom's connections: Slack, the two photo banks and two webhooks are on; one
 * webhook stopped answering. WordPress and the RSS feeds live in the desk's own records.
 */

const MIN = 60_000;

export function seedIntegrations(now: number): IntegrationsState {
  const ago = (minutes: number) => new Date(now - minutes * MIN).toISOString();

  const deliveries: WebhookDelivery[] = [
    { id: 'd-01', endpointId: 'wh-painel', event: 'news.priority_high', status: 200, ms: 182, at: ago(12), subject: 'Preço do camarão no atacado sobe pela quarta semana seguida' },
    { id: 'd-02', endpointId: 'wh-pautas', event: 'production.created', status: 500, ms: 1240, at: ago(26), subject: 'Exportações de tilápia crescem 38% no terceiro trimestre' },
    { id: 'd-03', endpointId: 'wh-painel', event: 'article.approved', status: 200, ms: 164, at: ago(48), subject: 'Cooperativa do Paraná inaugura frigorífico de peixes' },
    { id: 'd-04', endpointId: 'wh-pautas', event: 'production.created', status: 500, ms: 1310, at: ago(95), subject: 'Defeso da tainha começa em 1º de novembro no litoral Sul' },
    { id: 'd-05', endpointId: 'wh-painel', event: 'cms.sent', status: 200, ms: 201, at: ago(130), subject: 'Cooperativa do Paraná inaugura frigorífico de peixes' },
    { id: 'd-06', endpointId: 'wh-pautas', event: 'production.created', status: 0, ms: 10000, at: ago(210), subject: 'Governo abre consulta pública sobre rotulagem de pescado' },
    { id: 'd-07', endpointId: 'wh-painel', event: 'news.priority_high', status: 200, ms: 176, at: ago(260), subject: 'Exportações de tilápia crescem 38% no terceiro trimestre' },
    { id: 'd-08', endpointId: 'wh-pautas', event: 'production.created', status: 200, ms: 240, at: ago(1380), subject: 'Rede de supermercados amplia seção de pescados frescos' },
    { id: 'd-09', endpointId: 'wh-painel', event: 'news.priority_high', status: 410, ms: 98, at: ago(1500), subject: 'Exportadores de lagosta pedem revisão da cota para 2026' },
    { id: 'd-10', endpointId: 'wh-painel', event: 'article.approved', status: 200, ms: 158, at: ago(1620), subject: 'Pesquisa testa ração com farinha de inseto para tambaqui' },
  ];

  const activity: ActivityEntry[] = [
    { id: 'a-01', app: 'slack', kind: 'alert', at: ago(12), ok: true, title: 'Aviso em #pauta-quente', detail: 'Preço do camarão no atacado sobe pela quarta semana seguida' },
    { id: 'a-02', app: 'slack', kind: 'alert', at: ago(26), ok: true, title: 'Aviso em #redacao', detail: 'Pauta aberta: Exportações de tilápia crescem 38%' },
    { id: 'a-03', app: 'slack', kind: 'alert', at: ago(48), ok: true, title: 'Aviso em #publicacao', detail: 'Aprovado: Cooperativa do Paraná inaugura frigorífico' },
    { id: 'a-04', app: 'slack', kind: 'system', at: ago(4320), ok: true, title: 'Slack conectado', detail: 'Por João' },
    { id: 'a-05', app: 'unsplash', kind: 'photo', at: ago(35), ok: true, title: 'Foto salva no acervo', detail: 'Barco pesqueiro no porto de Itajaí' },
    { id: 'a-06', app: 'unsplash', kind: 'system', at: ago(9000), ok: true, title: 'Unsplash conectado', detail: 'Por João' },
    { id: 'a-07', app: 'pexels', kind: 'photo', at: ago(220), ok: true, title: 'Foto salva no acervo', detail: 'Tanques de criação de tilápia' },
    { id: 'a-08', app: 'pexels', kind: 'system', at: ago(9000), ok: true, title: 'Pexels conectado', detail: 'Por João' },
  ];

  return {
    version: 1,
    savedAt: new Date(now).toISOString(),
    apps: {
      slack: {
        state: 'connected',
        account: 'Portal do Pescado',
        credential: 'Token do bot xoxb-••••4f2a',
        connectedAt: ago(4320),
        connectedBy: 'João',
        checkedAt: ago(12),
        channels: ['#pauta-quente', '#redacao', '#publicacao', '#geral'],
        rules: [
          { event: 'news.priority_high', on: true, channel: '#pauta-quente' },
          { event: 'production.created', on: true, channel: '#redacao' },
          { event: 'article.drafted', on: false, channel: '#redacao' },
          { event: 'article.approved', on: true, channel: '#publicacao' },
          { event: 'cms.sent', on: false, channel: '#publicacao' },
          { event: 'cms.failed', on: true, channel: '' },
          { event: 'feed.failing', on: false, channel: '#redacao' },
        ],
      },
      unsplash: {
        state: 'connected',
        account: 'Chave de produção',
        credential: 'Access Key ••••a91f',
        connectedAt: ago(9000),
        connectedBy: 'João',
        checkedAt: ago(35),
        credit: 'Nome/Unsplash',
        saveOnUse: true,
        usage: { used: 312, limit: 5000, period: 'por hora' },
      },
      pexels: {
        state: 'connected',
        account: 'Chave de produção',
        credential: 'Chave da API ••••7c2e',
        connectedAt: ago(9000),
        connectedBy: 'João',
        checkedAt: ago(220),
        credit: 'Nome/Pexels',
        saveOnUse: true,
        usage: { used: 4180, limit: 20000, period: 'no mês' },
      },
    },
    endpoints: [
      {
        id: 'wh-painel',
        name: 'Painel da redação',
        url: 'https://painel.portal-do-pescado.exemplo/hooks/reporter',
        events: ['news.priority_high', 'article.approved', 'cms.sent'],
        secret: 'whsec_k3p9tq7vm2xw8rn4bd6hy5ca',
        state: 'active',
        createdAt: ago(20160),
      },
      {
        id: 'wh-pautas',
        name: 'Planilha de pautas',
        url: 'https://n8n.pescado-dados.exemplo/webhook/pautas',
        events: ['production.created'],
        secret: 'whsec_7fz2mq9k4tv8xp3nw6ry5bj3',
        state: 'failing',
        createdAt: ago(8640),
      },
    ],
    deliveries,
    activity,
    categoryMap: {
      exports: 'mercado',
      aquaculture: 'aquicultura',
      industry: 'industria',
      regulation: 'regulacao',
      fishing: 'pesca',
    },
  };
}
