import { endpointHost } from './integrations-model.ts';
import type { AppDef, AppId, AppRecord } from './integrations-model.ts';

/**
 * How each app connects in practice: what the newsroom does in the other app (with the link to the
 * exact page), what it pastes in the Reporter IA, what it pastes back in the app, and which API the
 * Reporter IA calls once connected. The backend implements exactly these calls; the screens only
 * read this file.
 */

export type FieldId = 'siteUrl' | 'apiUrl' | 'username' | 'clientId' | 'secret' | 'query' | 'feedUrl' | 'hookUrl' | 'sender';

export type CredentialField = {
  id: FieldId;
  label: string;
  kind: 'url' | 'text' | 'secret' | 'email';
  placeholder?: string;
  hint?: string;
  /** The address must be on this host (a Zapier hook, a Google Alertas feed). */
  host?: string;
  /** A WordPress application password: 24 letters and digits, shown in groups of 4. */
  format?: 'wp-password' | 'ghost-key';
};

export type GuideStep = {
  title: string;
  detail?: string;
  /** A page of the other app: absolute, or a path on the site the person typed. */
  link?: { label: string; href?: string; path?: string };
};

export type ApiCall = { method: 'GET' | 'POST' | 'PUT' | 'PATCH'; path: string; purpose: string };

export type ConnectGuide = {
  /** How the two systems trust each other, in one line. */
  method: string;
  /** Where the steps happen, when it is not the app itself ("No domínio do portal"). */
  where?: string;
  /** What the person does, in order; the last step happens on this page. */
  steps: GuideStep[];
  /** What the person pastes here. OAuth apps have none: the consent happens in the app. */
  fields: CredentialField[];
  /** What the person pastes back in the other app (an OAuth return address, DNS records). */
  provide?: { title: string; items: { label: string; value: string }[] };
  /** OAuth: what the app asks for at consent, with its technical name. */
  scopes?: { id: string; label: string }[];
  /** The step's primary. */
  action: string;
  /** Where the Reporter IA calls; `{site}` and `{api}` are the addresses typed. */
  base: string;
  auth: string;
  calls: ApiCall[];
  limits?: string;
};

const REDIRECT = 'https://app.reporteria.exemplo/oauth/callback';

export const GUIDES: Partial<Record<AppId, ConnectGuide>> = {
  wordpress: {
    method: 'Senha de aplicativo do WordPress (REST API)',
    steps: [
      { title: 'Crie um usuário para o Reporter IA', detail: 'Em Usuários › Adicionar novo, com a função Editor.', link: { label: 'Abrir usuários', path: '/wp-admin/user-new.php' } },
      { title: 'Gere uma senha de aplicativo', detail: 'Entre como esse usuário. Em Usuários › Perfil › Senhas de aplicativo, dê o nome Reporter IA e clique em Adicionar.', link: { label: 'Abrir perfil', path: '/wp-admin/profile.php#application-passwords-section' } },
      { title: 'Cole aqui o endereço, o usuário e a senha', detail: 'A senha aparece uma vez só, em 6 grupos de 4 caracteres.' },
    ],
    fields: [
      { id: 'siteUrl', label: 'Endereço do site', kind: 'url', placeholder: 'https://' },
      { id: 'username', label: 'Usuário', kind: 'text', placeholder: 'reporter-ia' },
      { id: 'secret', label: 'Senha de aplicativo', kind: 'secret', placeholder: 'xxxx xxxx xxxx xxxx xxxx xxxx', format: 'wp-password' },
    ],
    action: 'Conectar o site',
    base: '{site}/wp-json/wp/v2',
    auth: 'Basic (usuário e senha de aplicativo), só por HTTPS',
    calls: [
      { method: 'GET', path: '/users?who=authors', purpose: 'Ler os autores do portal' },
      { method: 'GET', path: '/categories', purpose: 'Ler as categorias' },
      { method: 'POST', path: '/media', purpose: 'Enviar a imagem de destaque' },
      { method: 'POST', path: '/posts', purpose: 'Criar o post como rascunho' },
      { method: 'POST', path: '/posts/{id}', purpose: 'Atualizar com a nova versão aprovada' },
    ],
  },
  ghost: {
    method: 'Admin API key de uma integração personalizada',
    steps: [
      { title: 'Crie uma integração personalizada', detail: 'No Ghost Admin, Settings › Integrations › Add custom integration, com o nome Reporter IA.', link: { label: 'Abrir integrações', path: '/ghost/#/settings/integrations' } },
      { title: 'Copie a Admin API key e a API URL', detail: 'As duas aparecem na página da integração.' },
      { title: 'Cole aqui' },
    ],
    fields: [
      { id: 'siteUrl', label: 'API URL', kind: 'url', placeholder: 'https://seusite.ghost.io' },
      { id: 'secret', label: 'Admin API key', kind: 'secret', placeholder: 'id:segredo', format: 'ghost-key' },
    ],
    action: 'Validar chave',
    base: '{site}/ghost/api/admin',
    auth: 'Token JWT de 5 min, assinado com a Admin API key',
    calls: [
      { method: 'POST', path: '/images/upload/', purpose: 'Enviar a imagem de destaque' },
      { method: 'POST', path: '/posts/?source=html', purpose: 'Criar o post como rascunho' },
      { method: 'PUT', path: '/posts/{id}/', purpose: 'Atualizar com a nova versão aprovada' },
    ],
  },
  drupal: {
    method: 'JSON:API com OAuth 2.0 (módulo Simple OAuth)',
    steps: [
      { title: 'Ative os módulos JSON:API e Simple OAuth', link: { label: 'Abrir módulos', path: '/admin/modules' } },
      { title: 'Crie um cliente OAuth', detail: 'Em Configuração › Simple OAuth › Clients, com o nome Reporter IA e a função Editor.', link: { label: 'Abrir clientes', path: '/admin/config/services/consumer' } },
      { title: 'Cole aqui o endereço, o Client ID e o segredo' },
    ],
    fields: [
      { id: 'siteUrl', label: 'Endereço do site', kind: 'url', placeholder: 'https://' },
      { id: 'clientId', label: 'Client ID', kind: 'text' },
      { id: 'secret', label: 'Client secret', kind: 'secret' },
    ],
    action: 'Conectar o site',
    base: '{site}/jsonapi',
    auth: 'OAuth 2.0, client credentials (token em /oauth/token)',
    calls: [
      { method: 'POST', path: '/node/article', purpose: 'Criar o artigo despublicado' },
      { method: 'POST', path: '/node/article/field_image', purpose: 'Enviar a imagem de destaque' },
      { method: 'PATCH', path: '/node/article/{uuid}', purpose: 'Atualizar com a nova versão aprovada' },
    ],
  },
  'google-alerts': {
    method: 'Feed RSS do alerta (o Google Alertas não tem API)',
    steps: [
      { title: 'Crie o alerta', detail: 'Digite a palavra-chave em Google Alertas.', link: { label: 'Abrir Google Alertas', href: 'https://www.google.com/alerts' } },
      { title: 'Entregue como feed', detail: 'Em Mostrar opções › Enviar para, escolha Feed RSS e clique em Criar alerta.' },
      { title: 'Copie o link do feed', detail: 'É o ícone de RSS ao lado do alerta. Cole aqui com a palavra-chave.' },
    ],
    fields: [
      { id: 'query', label: 'Palavra-chave', kind: 'text', placeholder: 'tilápia' },
      { id: 'feedUrl', label: 'Link do feed', kind: 'url', placeholder: 'https://www.google.com/alerts/feeds/…', host: 'www.google.com' },
    ],
    action: 'Ler o feed',
    base: 'https://www.google.com/alerts/feeds',
    auth: 'Sem credencial: o link do feed é privado',
    calls: [{ method: 'GET', path: '/{conta}/{alerta}', purpose: 'Ler as notícias novas a cada 15 min' }],
  },
  agency: {
    method: 'Chave de API do contrato de agência',
    steps: [
      { title: 'Peça o acesso à API de notícias', detail: 'A agência libera a API com o contrato de conteúdo.' },
      { title: 'Receba o endereço e a chave', detail: 'Chegam pelo atendimento da agência.' },
      { title: 'Cole aqui' },
    ],
    fields: [
      { id: 'apiUrl', label: 'Endereço da API', kind: 'url', placeholder: 'https://' },
      { id: 'secret', label: 'Chave da API', kind: 'secret' },
    ],
    action: 'Validar chave',
    base: '{api}',
    auth: 'Cabeçalho X-Api-Key',
    calls: [
      { method: 'GET', path: '/noticias?editoria={editoria}&desde={hora}', purpose: 'Ler as notícias novas a cada 5 min' },
      { method: 'GET', path: '/noticias/{id}', purpose: 'Ler o texto completo' },
    ],
  },
  slack: {
    method: 'OAuth 2.0: o app Reporter IA instalado no workspace',
    steps: [
      { title: 'Clique em Adicionar ao Slack', detail: 'O Slack abre; escolha o workspace da redação.' },
      { title: 'Aprove as permissões', detail: 'Quem aprova precisa poder instalar apps no workspace.' },
      { title: 'Convide o app aos canais privados', detail: 'Em cada canal privado, digite /invite @Reporter IA. Canais públicos não precisam.' },
    ],
    fields: [],
    scopes: [
      { id: 'chat:write', label: 'Enviar mensagens' },
      { id: 'channels:read', label: 'Ver os canais públicos' },
      { id: 'groups:read', label: 'Ver os canais privados em que o app está' },
    ],
    action: 'Adicionar ao Slack',
    base: 'https://slack.com/api',
    auth: 'Bearer com o token do bot, guardado no servidor',
    calls: [
      { method: 'GET', path: '/conversations.list', purpose: 'Listar os canais' },
      { method: 'POST', path: '/chat.postMessage', purpose: 'Enviar cada aviso' },
    ],
  },
  teams: {
    method: 'OAuth 2.0 com o Microsoft Entra ID (Microsoft Graph)',
    steps: [
      { title: 'Clique em Autorizar no Microsoft Teams', detail: 'Entre com uma conta de administrador do Microsoft 365.' },
      { title: 'Dê o consentimento do administrador', detail: 'Vale para a organização toda.' },
      { title: 'Adicione o app às equipes', detail: 'Em cada equipe, Aplicativos › Reporter IA › Adicionar.' },
    ],
    fields: [],
    scopes: [
      { id: 'ChannelMessage.Send', label: 'Enviar mensagens nos canais' },
      { id: 'Channel.ReadBasic.All', label: 'Ver as equipes e os canais' },
    ],
    action: 'Autorizar no Microsoft Teams',
    base: 'https://graph.microsoft.com/v1.0',
    auth: 'Token OAuth do Entra ID, renovado sozinho',
    calls: [
      { method: 'GET', path: '/teams/{equipe}/channels', purpose: 'Listar os canais' },
      { method: 'POST', path: '/teams/{equipe}/channels/{canal}/messages', purpose: 'Enviar cada aviso' },
    ],
  },
  email: {
    method: 'Envio pelo Reporter IA, com o domínio do portal verificado',
    where: 'No domínio do portal',
    steps: [
      { title: 'Escolha o remetente', detail: 'Um endereço do domínio do portal.' },
      { title: 'Crie os registros no DNS do domínio', detail: 'Quem cuida do domínio copia os três registros abaixo.' },
      { title: 'Verifique', detail: 'Leva até 1 h depois que o DNS propaga.' },
    ],
    fields: [{ id: 'sender', label: 'Remetente', kind: 'email', placeholder: 'redacao@seuportal.com.br' }],
    provide: {
      title: 'Registros de DNS',
      items: [
        { label: 'TXT @', value: 'v=spf1 include:mail.reporteria.exemplo ~all' },
        { label: 'CNAME reporter._domainkey', value: 'dkim.reporteria.exemplo' },
        { label: 'TXT _dmarc', value: 'v=DMARC1; p=none' },
      ],
    },
    action: 'Verificar domínio',
    base: 'Serviço de e-mail do Reporter IA',
    auth: 'Assinatura DKIM do domínio do portal',
    calls: [{ method: 'POST', path: '/emails', purpose: 'Enviar cada aviso e o resumo das 8:00' }],
  },
  unsplash: {
    method: 'Access Key de um app do Unsplash',
    steps: [
      { title: 'Crie um app no Unsplash', detail: 'Em Your apps › New Application, aceitando as regras da API.', link: { label: 'Abrir Unsplash Developers', href: 'https://unsplash.com/oauth/applications' } },
      { title: 'Copie a Access Key e cole aqui' },
      { title: 'Peça o modo Production', detail: 'Sobe o limite de 50 para 5.000 buscas por hora.' },
    ],
    fields: [{ id: 'secret', label: 'Access Key', kind: 'secret' }],
    action: 'Validar chave',
    base: 'https://api.unsplash.com',
    auth: 'Cabeçalho Authorization: Client-ID {Access Key}',
    calls: [
      { method: 'GET', path: '/search/photos', purpose: 'Buscar fotos' },
      { method: 'GET', path: '/photos/{id}/download', purpose: 'Registrar o uso (exigido pelo Unsplash)' },
    ],
    limits: '50 buscas por hora em teste, 5.000 em produção',
  },
  pexels: {
    method: 'Chave da API do Pexels',
    steps: [
      { title: 'Peça a chave', detail: 'Entre no Pexels e clique em Your API Key.', link: { label: 'Abrir Pexels API', href: 'https://www.pexels.com/api/' } },
      { title: 'Copie a chave e cole aqui' },
    ],
    fields: [{ id: 'secret', label: 'Chave da API', kind: 'secret' }],
    action: 'Validar chave',
    base: 'https://api.pexels.com/v1',
    auth: 'Cabeçalho Authorization: {chave}',
    calls: [
      { method: 'GET', path: '/search', purpose: 'Buscar fotos' },
      { method: 'GET', path: '/photos/{id}', purpose: 'Ler a foto escolhida' },
    ],
    limits: '200 buscas por hora, 20.000 por mês',
  },
  dam: {
    method: 'OAuth 2.0 com um app registrado no portal Bynder',
    steps: [
      { title: 'Registre o app no Bynder', detail: 'Em Settings › Advanced Settings › Portal Settings › OAuth Apps, crie Reporter IA com o endereço de retorno abaixo.' },
      { title: 'Copie o Client ID e o Client Secret' },
      { title: 'Cole aqui e clique em Autorizar no Bynder', detail: 'O Bynder pede para você entrar e aprovar.' },
    ],
    fields: [
      { id: 'siteUrl', label: 'Endereço do portal Bynder', kind: 'url', placeholder: 'https://suaempresa.bynder.com' },
      { id: 'clientId', label: 'Client ID', kind: 'text' },
      { id: 'secret', label: 'Client Secret', kind: 'secret' },
    ],
    provide: { title: 'Para colar no Bynder', items: [{ label: 'Endereço de retorno', value: `${REDIRECT}/bynder` }] },
    scopes: [
      { id: 'asset:read', label: 'Buscar e ver as imagens' },
      { id: 'offline', label: 'Continuar conectado' },
    ],
    action: 'Autorizar no Bynder',
    base: '{site}/api/v4',
    auth: 'OAuth 2.0, código de autorização com renovação',
    calls: [
      { method: 'GET', path: '/media', purpose: 'Buscar imagens' },
      { method: 'GET', path: '/media/{id}/download', purpose: 'Baixar a imagem escolhida' },
    ],
  },
  zapier: {
    method: 'Webhooks by Zapier (Catch Hook)',
    steps: [
      { title: 'Crie um Zap', detail: 'Gatilho Webhooks by Zapier › Catch Hook.', link: { label: 'Abrir Zapier', href: 'https://zapier.com/app/zaps' } },
      { title: 'Copie o endereço do gancho', detail: 'Começa com https://hooks.zapier.com/hooks/catch/.' },
      { title: 'Cole aqui e teste', detail: 'O teste manda um evento de exemplo para o Zapier montar o resto do Zap.' },
    ],
    fields: [{ id: 'hookUrl', label: 'Endereço do gancho', kind: 'url', placeholder: 'https://hooks.zapier.com/hooks/catch/…', host: 'hooks.zapier.com' }],
    action: 'Validar gancho',
    base: 'https://hooks.zapier.com/hooks/catch',
    auth: 'O endereço do gancho é o segredo; cada entrega vai assinada',
    calls: [{ method: 'POST', path: '/{conta}/{gancho}', purpose: 'Enviar cada evento escolhido' }],
  },
};

export function guideOf(id: AppId): ConnectGuide | undefined {
  return GUIDES[id];
}

export type FieldValues = Partial<Record<FieldId, string>>;

const compact = (value: string) => value.replace(/\s+/g, '');

/** What is wrong with a typed value, in the desk's words; `undefined` when it can be used. */
export function fieldProblem(field: CredentialField, value = ''): string | undefined {
  const text = value.trim();
  if (!text) return `Preencha ${field.label.toLowerCase()}.`;
  if (field.kind === 'url') {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return 'Cole o endereço completo, com https://.';
    }
    if (url.protocol !== 'https:') return 'Use um endereço https://.';
    if (field.host && url.host !== field.host) return `Use o endereço de ${field.host}.`;
    return undefined;
  }
  if (field.kind === 'email') return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text) ? undefined : 'Use um e-mail completo.';
  if (field.kind === 'secret') {
    if (field.format === 'wp-password') return /^[A-Za-z0-9]{24}$/.test(compact(text)) ? undefined : 'A senha de aplicativo tem 24 letras e números.';
    if (field.format === 'ghost-key') return /^[^:\s]+:[^:\s]{16,}$/.test(text) ? undefined : 'Use a chave inteira, no formato id:segredo.';
    if (text.length < 12 || /\s/.test(text)) return 'A chave parece incompleta.';
  }
  return undefined;
}

export function fieldProblems(guide: ConnectGuide, values: FieldValues): Partial<Record<FieldId, string>> {
  const problems: Partial<Record<FieldId, string>> = {};
  for (const field of guide.fields) {
    const problem = fieldProblem(field, values[field.id]);
    if (problem) problems[field.id] = problem;
  }
  return problems;
}

const origin = (value?: string) => {
  try {
    return value ? new URL(value.trim()).origin : undefined;
  } catch {
    return undefined;
  }
};

/** A link of a step: absolute, or a path on the site typed so far (none while it is not valid). */
export function stepHref(step: GuideStep, values: FieldValues): string | undefined {
  if (step.link?.href) return step.link.href;
  if (!step.link?.path) return undefined;
  const site = origin(values.siteUrl);
  return site ? `${site}${step.link.path}` : undefined;
}

/** The API's address with the typed site in place. */
export function apiBase(guide: ConnectGuide, record: Pick<AppRecord, 'siteUrl' | 'apiUrl'>): string {
  return guide.base
    .replace('{site}', origin(record.siteUrl) ?? 'https://seusite')
    .replace('{api}', record.apiUrl?.trim().replace(/\/$/, '') ?? 'https://api');
}

/**
 * What the connection keeps from the typed values: the addresses, the account the app answered for,
 * and a description of the credential. A secret is never kept, only its last 4 characters.
 */
export function connectionFrom(def: Pick<AppDef, 'id' | 'name' | 'auth'>, guide: ConnectGuide, values: FieldValues): Partial<AppRecord> {
  const secretField = guide.fields.find((field) => field.id === 'secret');
  const secret = values.secret ? compact(values.secret) : '';
  const site = origin(values.siteUrl);
  const credential = secretField && secret
    ? values.username ? `${secretField.label} de ${values.username.trim()}` : `${secretField.label} ••••${secret.slice(-4)}`
    : def.auth === 'oauth' ? 'Token OAuth, guardado no servidor' : undefined;
  const account = site ? endpointHost(site)
    : values.apiUrl ? endpointHost(values.apiUrl)
      : values.sender ? values.sender.trim()
        : values.query ? `Alerta “${values.query.trim()}”`
          : values.hookUrl ? endpointHost(values.hookUrl)
            : def.auth === 'oauth' ? 'Portal do Pescado'
              : credential ?? def.name;
  return {
    account,
    ...(credential ? { credential } : {}),
    ...(site ? { siteUrl: site } : {}),
    ...(values.apiUrl ? { apiUrl: values.apiUrl.trim() } : {}),
    ...(values.username ? { username: values.username.trim() } : {}),
    ...(values.sender ? { sender: values.sender.trim() } : {}),
    ...(values.hookUrl ? { hookUrl: values.hookUrl.trim() } : {}),
    ...(values.query && values.feedUrl ? { feeds: [{ query: values.query.trim(), url: values.feedUrl.trim() }] } : {}),
  };
}

/**
 * What a system that receives the webhooks gets, and how it checks that the Reporter IA sent it.
 * The backend signs and retries exactly like this.
 */
export const WEBHOOK_SPEC = {
  request: [
    { label: 'Método', value: 'POST, corpo em JSON (UTF-8)' },
    { label: 'X-Reporter-Event', value: 'news.priority_high' },
    { label: 'X-Reporter-Delivery', value: 'dlv_01JAB3K9Q2W7' },
    { label: 'X-Reporter-Signature', value: 't=1760723280,v1=5f2c9a41d0…' },
    { label: 'Resposta esperada', value: 'Qualquer 2xx em até 10 s' },
    { label: 'Novas tentativas', value: '5 em 24 h: 1 min, 5 min, 30 min, 2 h e 12 h' },
  ],
  signature: [
    { title: 'Separe t e v1 do cabeçalho X-Reporter-Signature' },
    { title: 'Calcule o HMAC SHA-256 de “t.corpo” com o segredo do endpoint', detail: 'O corpo exatamente como chegou, antes de ler o JSON.' },
    { title: 'Aceite só se o resultado for igual a v1 e t tiver menos de 5 min', detail: 'Use o id da entrega para ignorar repetições.' },
  ],
  example: {
    id: 'evt_01JAB3K9Q2',
    event: 'news.priority_high',
    created_at: '2026-10-17T14:48:00-03:00',
    data: {
      news_id: 'news-camarao-atacado',
      title: 'Preço do camarão no atacado sobe pela quarta semana seguida',
      source: 'Agência Litoral',
      url: 'https://agencialitoral.exemplo/camarao-atacado',
      priority: 'high',
      score: 86,
      desk_url: 'https://app.reporteria.exemplo/news?item=news-camarao-atacado',
    },
  },
} as const;

/** The example body as rows ("data.title" → its value), for a table the desk can read. */
export function exampleFields(value: unknown, prefix = ''): { field: string; example: string }[] {
  if (value === null || typeof value !== 'object') return [{ field: prefix, example: String(value) }];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) => exampleFields(inner, prefix ? `${prefix}.${key}` : key));
}
