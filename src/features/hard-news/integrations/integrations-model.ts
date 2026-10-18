/**
 * Integrações (R2 preview): the catalog of apps a newsroom connects, the state of each connection,
 * the events the desk emits and the webhooks that receive them. Pure rules, no React and no clock
 * reads, so `node --test` runs them and the backend can serve the same shapes.
 */

export type AppId =
  | 'wordpress'
  | 'ghost'
  | 'drupal'
  | 'rss'
  | 'google-alerts'
  | 'agency'
  | 'slack'
  | 'teams'
  | 'email'
  | 'unsplash'
  | 'pexels'
  | 'dam'
  | 'webhooks'
  | 'zapier'
  | 'search-console'
  | 'analytics'
  | 'plaud'
  | 'youtube';

export type CategoryId = 'publish' | 'sources' | 'chat' | 'images' | 'automation' | 'data' | 'media';

export const CATEGORIES: readonly { id: CategoryId; label: string }[] = [
  { id: 'publish', label: 'Publicação' },
  { id: 'sources', label: 'Fontes de notícias' },
  { id: 'chat', label: 'Comunicação' },
  { id: 'images', label: 'Imagens' },
  { id: 'automation', label: 'Automação' },
  { id: 'data', label: 'Dados e audiência' },
  { id: 'media', label: 'Áudio e vídeo' },
];

/** Which configuration the app page shows. */
export type AppKind = 'cms' | 'publisher' | 'feeds' | 'alerts' | 'agency' | 'chat' | 'email' | 'images' | 'webhooks' | 'automation' | 'later';

/**
 * How "Conectar" works: the app's own consent page (OAuth), credentials pasted from the app (a key,
 * an application password, a feed or hook address), or nothing to connect.
 */
export type AuthKind = 'oauth' | 'credentials' | 'none';

export type AppDef = {
  id: AppId;
  name: string;
  category: CategoryId;
  kind: AppKind;
  /** One line in the catalog. */
  summary: string;
  auth: AuthKind;
  /** Later release: shown, never connectable. */
  since?: 'R3' | 'R4' | 'R6';
  /**
   * The company's logo, hotlinked (Simple Icons, CC0, or the site's favicon); BrandMark falls back to
   * its glyph when it fails. Generic entries without a company (E-mail, Webhooks) have none.
   */
  logo?: string;
};

export const CATALOG: readonly AppDef[] = [
  { id: 'wordpress', name: 'WordPress', category: 'publish', kind: 'cms', auth: 'credentials', summary: 'Recebe os artigos aprovados como rascunho', logo: 'https://cdn.simpleicons.org/wordpress' },
  { id: 'ghost', name: 'Ghost', category: 'publish', kind: 'publisher', auth: 'credentials', summary: 'Publica no Ghost do portal', logo: 'https://cdn.simpleicons.org/ghost' },
  { id: 'drupal', name: 'Drupal', category: 'publish', kind: 'publisher', auth: 'credentials', summary: 'Publica no Drupal do portal', logo: 'https://cdn.simpleicons.org/drupal' },
  { id: 'rss', name: 'Feeds RSS', category: 'sources', kind: 'feeds', auth: 'none', summary: 'Os veículos que a redação acompanha', logo: 'https://cdn.simpleicons.org/rss' },
  { id: 'google-alerts', name: 'Google Alertas', category: 'sources', kind: 'alerts', auth: 'credentials', summary: 'Alertas por palavra-chave no radar', logo: 'https://www.google.com/s2/favicons?domain=google.com&sz=128' },
  { id: 'agency', name: 'Estadão Conteúdo', category: 'sources', kind: 'agency', auth: 'credentials', summary: 'Notícias de agência direto no radar', logo: 'https://www.google.com/s2/favicons?domain=estadao.com.br&sz=128' },
  { id: 'slack', name: 'Slack', category: 'chat', kind: 'chat', auth: 'oauth', summary: 'Avisos da redação nos canais certos', logo: 'https://www.google.com/s2/favicons?domain=api.slack.com&sz=128' },
  { id: 'teams', name: 'Microsoft Teams', category: 'chat', kind: 'chat', auth: 'oauth', summary: 'Avisos da redação nos canais do Teams', logo: 'https://www.google.com/s2/favicons?domain=teams.microsoft.com&sz=128' },
  { id: 'email', name: 'E-mail', category: 'chat', kind: 'email', auth: 'credentials', summary: 'Avisos e resumo do dia por e-mail' },
  { id: 'unsplash', name: 'Unsplash', category: 'images', kind: 'images', auth: 'credentials', summary: 'Fotos livres na busca de imagens', logo: 'https://cdn.simpleicons.org/unsplash' },
  { id: 'pexels', name: 'Pexels', category: 'images', kind: 'images', auth: 'credentials', summary: 'Fotos livres na busca de imagens', logo: 'https://cdn.simpleicons.org/pexels' },
  { id: 'dam', name: 'Bynder', category: 'images', kind: 'images', auth: 'oauth', summary: 'O banco de imagens da empresa', logo: 'https://www.google.com/s2/favicons?domain=bynder.com&sz=128' },
  { id: 'webhooks', name: 'Webhooks', category: 'automation', kind: 'webhooks', auth: 'none', summary: 'Eventos da redação nos seus sistemas' },
  { id: 'zapier', name: 'Zapier', category: 'automation', kind: 'automation', auth: 'credentials', summary: 'Tarefas automáticas com outros apps', logo: 'https://cdn.simpleicons.org/zapier' },
  { id: 'search-console', name: 'Search Console', category: 'data', kind: 'later', auth: 'oauth', since: 'R3', summary: 'Buscas que trazem leitores', logo: 'https://cdn.simpleicons.org/googlesearchconsole' },
  { id: 'analytics', name: 'Google Analytics', category: 'data', kind: 'later', auth: 'oauth', since: 'R6', summary: 'Audiência de cada matéria', logo: 'https://cdn.simpleicons.org/googleanalytics' },
  { id: 'plaud', name: 'Plaud', category: 'media', kind: 'later', auth: 'oauth', since: 'R3', summary: 'Gravações e transcrições de entrevistas', logo: 'https://www.google.com/s2/favicons?domain=plaud.ai&sz=128' },
  { id: 'youtube', name: 'YouTube', category: 'media', kind: 'later', auth: 'oauth', since: 'R4', summary: 'Vídeos e cortes do portal', logo: 'https://cdn.simpleicons.org/youtube' },
];

export function appDef(id: string): AppDef | undefined {
  return CATALOG.find((app) => app.id === id);
}

// ── Status ───────────────────────────────────────────────────────────────────────────────────

export type AppStatus = 'connected' | 'failing' | 'available' | 'soon';

export const STATUS_META: Record<AppStatus, { label: string; tone: 'green' | 'red' | 'gray'; hollow?: boolean }> = {
  connected: { label: 'Conectado', tone: 'green' },
  failing: { label: 'Com erro', tone: 'red' },
  available: { label: 'Disponível', tone: 'gray', hollow: true },
  soon: { label: 'Em breve', tone: 'gray' },
};

export type ConnectionState = 'connected' | 'disconnected' | 'failing';

export function statusOf(def: Pick<AppDef, 'since'>, connection: ConnectionState | undefined): AppStatus {
  if (def.since) return 'soon';
  if (connection === 'connected') return 'connected';
  if (connection === 'failing') return 'failing';
  return 'available';
}

export const isLive = (status: AppStatus) => status === 'connected' || status === 'failing';

// ── Catalog view ─────────────────────────────────────────────────────────────────────────────

export type CatalogTab = 'all' | 'connected' | 'available';

export type CatalogEntry = AppDef & { status: AppStatus };

export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

const categoryLabel = (id: CategoryId) => CATEGORIES.find((category) => category.id === id)?.label ?? '';

export function matchesTab(status: AppStatus, tab: CatalogTab): boolean {
  if (tab === 'connected') return isLive(status);
  if (tab === 'available') return status === 'available';
  return true;
}

export function matchesQuery(entry: Pick<AppDef, 'name' | 'summary' | 'category'>, query: string): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalize(`${entry.name} ${entry.summary} ${categoryLabel(entry.category)}`);
  return words.every((word) => haystack.includes(word));
}

export function catalogCounts(entries: readonly CatalogEntry[]): Record<CatalogTab, number> {
  return {
    all: entries.length,
    connected: entries.filter((entry) => isLive(entry.status)).length,
    available: entries.filter((entry) => entry.status === 'available').length,
  };
}

const ORDER: Record<AppStatus, number> = { failing: 0, connected: 1, available: 2, soon: 3 };

/**
 * The catalog by category, in the categories' order. Inside a category, what needs attention comes
 * first, then what is connected, then what can be connected, then what arrives later. Empty
 * categories are dropped.
 */
export function catalogGroups<T extends CatalogEntry>(entries: readonly T[], tab: CatalogTab, query: string) {
  return CATEGORIES.map((category) => {
    const apps = entries
      .filter((entry) => entry.category === category.id && matchesTab(entry.status, tab) && matchesQuery(entry, query))
      .sort((a, b) => ORDER[a.status] - ORDER[b.status]);
    const live = entries.filter((entry) => entry.category === category.id && isLive(entry.status)).length;
    return { ...category, apps, live };
  }).filter((group) => group.apps.length > 0);
}

// ── Events ───────────────────────────────────────────────────────────────────────────────────

export type EventId =
  | 'news.priority_high'
  | 'production.created'
  | 'article.drafted'
  | 'article.approved'
  | 'cms.sent'
  | 'cms.failed'
  | 'feed.failing';

/** What the desk emits; chat rules, e-mail and webhooks subscribe to the same list. */
export const EVENTS: readonly { id: EventId; label: string }[] = [
  { id: 'news.priority_high', label: 'Notícia de prioridade alta' },
  { id: 'production.created', label: 'Pauta aberta' },
  { id: 'article.drafted', label: 'Artigo escrito pela IA' },
  { id: 'article.approved', label: 'Artigo aprovado' },
  { id: 'cms.sent', label: 'Enviado ao CMS' },
  { id: 'cms.failed', label: 'Falha no envio ao CMS' },
  { id: 'feed.failing', label: 'Fonte sem resposta' },
];

export function eventLabel(id: EventId): string {
  return EVENTS.find((event) => event.id === id)?.label ?? id;
}

// ── Records kept by the preview store ────────────────────────────────────────────────────────

/** One alert of a chat app: which event, on or off, and where it lands. */
export type ChatRule = { event: EventId; on: boolean; channel: string };

export type AppRecord = {
  state: ConnectionState;
  /** Workspace, site, key label: what the app answered when authorized. */
  account?: string;
  connectedAt?: string;
  connectedBy?: string;
  checkedAt?: string;
  error?: string;
  /** The connect flow, while not connected: the step on screen and what was authorized. */
  setup?: { step: number; account?: string };
  channels?: string[];
  rules?: ChatRule[];
  recipients?: string[];
  digest?: boolean;
  /** Google Alertas: one RSS feed per alert. */
  feeds?: { query: string; url: string }[];
  sections?: string[];
  events?: EventId[];
  siteUrl?: string;
  apiUrl?: string;
  username?: string;
  sender?: string;
  hookUrl?: string;
  /** How the app trusts the Reporter IA, never the secret itself ("Access Key ••••a91f"). */
  credential?: string;
  credit?: string;
  saveOnUse?: boolean;
  usage?: { used: number; limit: number; period: string };
};

export type EndpointState = 'active' | 'failing' | 'paused';

export type WebhookEndpoint = {
  id: string;
  url: string;
  name: string;
  events: EventId[];
  secret: string;
  state: EndpointState;
  createdAt: string;
};

export type WebhookDelivery = {
  id: string;
  endpointId: string;
  event: EventId;
  /** HTTP status; 0 when the endpoint did not answer in time. */
  status: number;
  ms: number;
  at: string;
  /** What the delivery carried, in the desk's words ("Exportações de tilápia crescem 38%…"). */
  subject: string;
};

export type ActivityEntry = {
  id: string;
  app: AppId;
  /** `alert`: a message the app delivered · `photo`: a photo saved to the archive · `system`: connected, tested. */
  kind: 'alert' | 'photo' | 'system';
  at: string;
  title: string;
  detail?: string;
  ok: boolean;
};

export type IntegrationsState = {
  version: 1;
  /** Last write: on load, every time moves by the time away so the example keeps its rhythm. */
  savedAt: string;
  apps: Partial<Record<AppId, AppRecord>>;
  endpoints: WebhookEndpoint[];
  deliveries: WebhookDelivery[];
  activity: ActivityEntry[];
  /** WordPress: the editorial map's topics → the portal's categories. */
  categoryMap: Record<string, string>;
};

// ── Webhooks ─────────────────────────────────────────────────────────────────────────────────

/** What is wrong with an endpoint address, in the desk's words; `undefined` when it can be used. */
export function endpointProblem(value: string, taken: readonly string[] = []): string | undefined {
  const text = value.trim();
  if (!text) return 'Cole o endereço que vai receber os eventos.';
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return 'Cole o endereço completo, com https://.';
  }
  if (url.protocol !== 'https:') return 'Use um endereço https://.';
  if (taken.some((existing) => existing.replace(/\/$/, '') === text.replace(/\/$/, ''))) return 'Esse endereço já recebe eventos.';
  return undefined;
}

export function endpointHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const SECRET_ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789';

/** A signing secret (`whsec_` and 24 characters); `random` returns [0, 1), injectable for tests. */
export function newSecret(random: () => number = Math.random): string {
  let body = '';
  for (let index = 0; index < 24; index += 1) body += SECRET_ALPHABET[Math.floor(random() * SECRET_ALPHABET.length)];
  return `whsec_${body}`;
}

/** "whsec_••••••••3f9a": enough to tell two secrets apart, never enough to use one. */
export function maskSecret(secret: string): string {
  const prefix = secret.startsWith('whsec_') ? 'whsec_' : '';
  return `${prefix}••••••••${secret.slice(-4)}`;
}

export type DeliveryOutcome = 'ok' | 'refused' | 'failed';

export function deliveryOutcome(status: number): DeliveryOutcome {
  if (status >= 200 && status < 300) return 'ok';
  if (status >= 400 && status < 500) return 'refused';
  return 'failed';
}

export function deliveryLabel(status: number): string {
  return status === 0 ? 'Sem resposta' : String(status);
}

/** Deliveries of one endpoint, newest first. */
export function deliveriesOf(deliveries: readonly WebhookDelivery[], endpointId: string): WebhookDelivery[] {
  return deliveries.filter((delivery) => delivery.endpointId === endpointId).sort((a, b) => b.at.localeCompare(a.at));
}

/** Share of the endpoint's last `window` deliveries that arrived (2xx), from 0 to 1; `undefined` with none. */
export function successRate(deliveries: readonly WebhookDelivery[], endpointId: string, window = 20): number | undefined {
  const recent = deliveriesOf(deliveries, endpointId).slice(0, window);
  if (recent.length === 0) return undefined;
  return recent.filter((delivery) => deliveryOutcome(delivery.status) === 'ok').length / recent.length;
}

/** How many of the newest deliveries failed in a row. */
export function failureStreak(deliveries: readonly WebhookDelivery[], endpointId: string): number {
  let streak = 0;
  for (const delivery of deliveriesOf(deliveries, endpointId)) {
    if (deliveryOutcome(delivery.status) === 'ok') break;
    streak += 1;
  }
  return streak;
}

/** The webhooks app is connected while it has endpoints, and failing when one of them fails. */
export function webhooksState(endpoints: readonly WebhookEndpoint[]): ConnectionState {
  if (endpoints.length === 0) return 'disconnected';
  return endpoints.some((endpoint) => endpoint.state === 'failing') ? 'failing' : 'connected';
}

// ── Health of a connection ───────────────────────────────────────────────────────────────────

export type CheckState = 'ok' | 'warn' | 'error';

/** One line of "Funcionamento": what was checked, its state, and where to fix it. */
export type HealthCheck = { id: string; label: string; state: CheckState; detail: string; fix?: string };

/** Chat apps: authorized, every alert that is on has a channel, at least one alert is on. */
export function chatChecks(record: AppRecord): HealthCheck[] {
  const rules = record.rules ?? [];
  const on = rules.filter((rule) => rule.on);
  const orphan = on.filter((rule) => !rule.channel);
  return [
    record.state === 'failing'
      ? { id: 'auth', label: 'Autorização', state: 'error', detail: record.error ?? 'O app recusou a conexão.', fix: 'Autorizar de novo' }
      : { id: 'auth', label: 'Autorização', state: 'ok', detail: record.account ?? 'Autorizado' },
    on.length === 0
      ? { id: 'rules', label: 'Avisos', state: 'warn', detail: 'Nenhum aviso ligado.', fix: 'Ligar avisos' }
      : orphan.length
        ? { id: 'rules', label: 'Avisos', state: 'warn', detail: orphan.length === 1 ? '1 aviso sem canal.' : `${orphan.length} avisos sem canal.`, fix: 'Escolher canal' }
        : { id: 'rules', label: 'Avisos', state: 'ok', detail: on.length === 1 ? '1 aviso ligado' : `${on.length} avisos ligados` },
  ];
}

/**
 * WordPress: the connection, who signs in the portal and where each topic lands. People without
 * their own author sign as the newsroom; topics without a category wait for one in the Entrega.
 */
export function cmsChecks(input: {
  status: ConnectionState;
  host: string;
  unmappedPeople: readonly string[];
  unmappedTopics: readonly string[];
  failedSends: number;
}): HealthCheck[] {
  const { status, host, unmappedPeople, unmappedTopics, failedSends } = input;
  const people = unmappedPeople.length;
  const topics = unmappedTopics.length;
  return [
    status === 'failing'
      ? { id: 'auth', label: 'Conexão', state: 'error', detail: `${host} não respondeu ao último teste.`, fix: 'Testar de novo' }
      : { id: 'auth', label: 'Conexão', state: 'ok', detail: host },
    people
      ? { id: 'authors', label: 'Autores', state: 'warn', detail: people === 1 ? `${unmappedPeople[0]} assina como Redação.` : `${people} pessoas assinam como Redação.`, fix: 'Mapear autores' }
      : { id: 'authors', label: 'Autores', state: 'ok', detail: 'Todos com autor no portal' },
    topics
      ? { id: 'categories', label: 'Categorias', state: 'warn', detail: topics === 1 ? `${unmappedTopics[0]} sem categoria.` : `${topics} temas sem categoria.`, fix: 'Mapear categorias' }
      : { id: 'categories', label: 'Categorias', state: 'ok', detail: 'Todos os temas com categoria' },
    failedSends
      ? { id: 'sends', label: 'Envios', state: 'error', detail: failedSends === 1 ? '1 envio falhou.' : `${failedSends} envios falharam.`, fix: 'Ver envios' }
      : { id: 'sends', label: 'Envios', state: 'ok', detail: 'Nenhuma falha' },
  ];
}

/** The worst state among the checks, for the summary line. */
export function overall(checks: readonly HealthCheck[]): CheckState {
  if (checks.some((check) => check.state === 'error')) return 'error';
  if (checks.some((check) => check.state === 'warn')) return 'warn';
  return 'ok';
}

// ── Time ─────────────────────────────────────────────────────────────────────────────────────

const shiftIso = (value: string | undefined, by: number) => (value ? new Date(new Date(value).getTime() + by).toISOString() : value);

/**
 * Moves every time of the example by the time away from the last write, so "há 2 h" still reads
 * "há 2 h" a day later (the desk does the same with its records).
 */
export function rebase(state: IntegrationsState, now: number): IntegrationsState {
  const by = now - new Date(state.savedAt).getTime();
  if (!Number.isFinite(by) || by <= 0) return state;
  const apps = Object.fromEntries(Object.entries(state.apps).map(([id, record]) => [id, record && {
    ...record,
    connectedAt: shiftIso(record.connectedAt, by),
    checkedAt: shiftIso(record.checkedAt, by),
  }])) as IntegrationsState['apps'];
  return {
    ...state,
    savedAt: new Date(now).toISOString(),
    apps,
    endpoints: state.endpoints.map((endpoint) => ({ ...endpoint, createdAt: shiftIso(endpoint.createdAt, by) ?? endpoint.createdAt })),
    deliveries: state.deliveries.map((delivery) => ({ ...delivery, at: shiftIso(delivery.at, by) ?? delivery.at })),
    activity: state.activity.map((entry) => ({ ...entry, at: shiftIso(entry.at, by) ?? entry.at })),
  };
}

// ── Connect flow ─────────────────────────────────────────────────────────────────────────────

export type SetupStepId = 'connect' | 'configure' | 'test';

/** Conectar → Configurar → Testar; an app with nothing to connect starts at Configurar. */
export function setupSteps(def: Pick<AppDef, 'auth'>): { id: SetupStepId; label: string }[] {
  return [
    ...(def.auth === 'none' ? [] : [{ id: 'connect' as const, label: 'Conectar' }]),
    { id: 'configure', label: 'Configurar' },
    { id: 'test', label: 'Testar' },
  ];
}

/** What "Configurar" starts with, so the first test already does something useful. */
export function setupDefaults(def: Pick<AppDef, 'id' | 'kind' | 'name'>): Partial<AppRecord> {
  switch (def.kind) {
    case 'chat': {
      const channels = def.id === 'teams' ? ['Redação', 'Pauta quente', 'Publicação', 'Geral'] : ['#redacao', '#pauta-quente', '#publicacao', '#geral'];
      const [newsroom = '', hot = '', publishing = ''] = channels;
      return {
        channels,
        rules: EVENTS.map((event) => ({
          event: event.id,
          on: event.id === 'news.priority_high' || event.id === 'article.approved' || event.id === 'cms.failed',
          channel: event.id === 'news.priority_high' ? hot : event.id === 'article.approved' || event.id === 'cms.sent' ? publishing : newsroom,
        })),
      };
    }
    case 'email':
      return {
        recipients: ['redacao@portal-do-pescado.exemplo'],
        digest: true,
        rules: EVENTS.map((event) => ({ event: event.id, on: event.id === 'news.priority_high' || event.id === 'cms.failed', channel: '' })),
      };
    case 'images':
      return { credit: `Nome/${def.name}`, saveOnUse: true, usage: { used: 0, limit: def.id === 'dam' ? 10000 : 5000, period: def.id === 'dam' ? 'no mês' : 'por hora' } };
    case 'agency':
      return { sections: ['Agronegócio', 'Economia'] };
    case 'automation':
      return { events: ['article.approved', 'cms.sent'] };
    default:
      return {};
  }
}

/** The checks "Testar" runs, in order, with what each one found. */
export function testPlan(kind: AppKind, record: AppRecord): { id: string; label: string; meta?: string }[] {
  switch (kind) {
    case 'chat': {
      const first = record.rules?.find((rule) => rule.on && rule.channel)?.channel;
      return [
        { id: 'auth', label: 'Autorização válida' },
        { id: 'channels', label: 'Canais encontrados', meta: `${record.channels?.length ?? 0} canais` },
        { id: 'message', label: 'Mensagem de teste entregue', ...(first ? { meta: first } : {}) },
      ];
    }
    case 'email':
      return [
        { id: 'recipients', label: 'Destinatários válidos', meta: `${record.recipients?.length ?? 0}` },
        { id: 'message', label: 'E-mail de teste entregue' },
      ];
    case 'images':
      return [
        { id: 'auth', label: 'Chave aceita' },
        { id: 'search', label: 'Busca de teste', meta: '24 fotos' },
      ];
    case 'alerts':
      return [
        { id: 'feed', label: 'O feed respondeu' },
        { id: 'read', label: 'Primeiros alertas lidos', meta: '6 notícias' },
      ];
    case 'agency':
      return [
        { id: 'auth', label: 'Chave aceita' },
        { id: 'read', label: 'Primeiras notícias lidas', meta: '12 notícias' },
      ];
    case 'publisher':
    case 'cms':
      return [
        { id: 'site', label: 'O site respondeu' },
        { id: 'read', label: 'Autores e categorias lidos' },
        { id: 'draft', label: 'Rascunho de teste criado e apagado' },
      ];
    default:
      return [
        { id: 'auth', label: 'Chave aceita' },
        { id: 'event', label: 'Evento de teste recebido' },
      ];
  }
}

/**
 * "Funcionamento" of an app other than WordPress and the webhooks: the authorization, then what the
 * app needs to be useful (alerts on, recipients, keywords, events) or what is close to a limit.
 */
export function appChecks(def: Pick<AppDef, 'kind'>, record: AppRecord): HealthCheck[] {
  const auth: HealthCheck = record.state === 'failing'
    ? { id: 'auth', label: 'Autorização', state: 'error', detail: record.error ?? 'O app recusou a conexão.', fix: 'Autorizar de novo' }
    : { id: 'auth', label: 'Autorização', state: 'ok', detail: record.account ?? 'Autorizado' };
  switch (def.kind) {
    case 'chat':
      return chatChecks(record);
    case 'email': {
      const recipients = record.recipients?.length ?? 0;
      const on = record.rules?.filter((rule) => rule.on).length ?? 0;
      return [
        recipients
          ? { id: 'recipients', label: 'Destinatários', state: 'ok', detail: recipients === 1 ? '1 destinatário' : `${recipients} destinatários` }
          : { id: 'recipients', label: 'Destinatários', state: 'warn', detail: 'Nenhum destinatário.', fix: 'Adicionar destinatários' },
        on || record.digest
          ? { id: 'rules', label: 'Avisos', state: 'ok', detail: record.digest ? 'Resumo do dia ligado' : `${on} avisos ligados` }
          : { id: 'rules', label: 'Avisos', state: 'warn', detail: 'Nenhum aviso ligado.', fix: 'Ligar avisos' },
      ];
    }
    case 'images': {
      const usage = record.usage;
      const ratio = usage && usage.limit ? usage.used / usage.limit : 0;
      return [
        auth,
        ratio >= 0.8
          ? { id: 'usage', label: 'Uso', state: 'warn', detail: 'Perto do limite do plano.', fix: 'Ver uso' }
          : { id: 'usage', label: 'Uso', state: 'ok', detail: usage ? `${Math.round(ratio * 100)}% do limite ${usage.period}` : 'Sem uso ainda' },
      ];
    }
    case 'alerts':
      return [
        record.feeds?.length
          ? { id: 'queries', label: 'Alertas', state: 'ok', detail: record.feeds.length === 1 ? '1 alerta lido' : `${record.feeds.length} alertas lidos` }
          : { id: 'queries', label: 'Alertas', state: 'warn', detail: 'Nenhum alerta.', fix: 'Adicionar alerta' },
      ];
    case 'automation':
      return [
        auth,
        record.events?.length
          ? { id: 'events', label: 'Eventos', state: 'ok', detail: `${record.events.length} eventos enviados` }
          : { id: 'events', label: 'Eventos', state: 'warn', detail: 'Nenhum evento escolhido.', fix: 'Escolher eventos' },
      ];
    default:
      return [auth];
  }
}

