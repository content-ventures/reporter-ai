import { AUDIT_READER_ROLES } from '../domain/audit.ts';
import type { Role } from '../domain/workspace.ts';
import type { IconKey } from './icons.ts';
import { availableIn, CURRENT_RELEASE, isReleased, RELEASE_NAMES } from './release.ts';
import type { ReleaseId } from './release.ts';

/**
 * Menu registry (PLAN §2). The sidebar shows the whole product map, R1–R7 (`menuFor`): items of
 * the current release navigate, items of later releases show "Em breve" with no link, and their
 * routes keep answering 404 until the release ships. ⌘K, the active item and the trail use only
 * released items (`navigationFor`, `activeNavItem`). Role filtering comes first: nobody sees an
 * item they will not have access to, not even as "Em breve".
 * "Nova produção" is a primary action and a ⌘K command, never a menu item.
 */

export type NavGroupId = 'production' | 'intake' | 'library' | 'distribution' | 'settings' | 'administration' | 'utility';

/** `main` groups stack in the sidebar body; `utility` sits at the bottom, above the account. */
export type NavPlacement = 'main' | 'utility';

export type NavGroup = {
  id: NavGroupId;
  label: string;
  placement: NavPlacement;
  since: ReleaseId;
  /** The label folds the group (open by default; the whole map shows on arrival). */
  collapsible: boolean;
};

/** Live counters the shell may attach to an item (NavItem.count in the DS Sidebar). */
export type NavBadge = 'awaiting-approval';

export type NavItem = {
  id: string;
  label: string;
  icon: IconKey;
  href: string;
  group: NavGroupId;
  since: ReleaseId;
  /** `exact` for `/`; `prefix` keeps the item active on nested routes (`/productions/123`). */
  match: 'exact' | 'prefix';
  /** Roadmap features this screen answers (F1.1…F7.6); stages and piece kinds live inside Produções. */
  features: readonly string[];
  /** What the screen will do, shown with "Em breve" before its release ships. */
  hint?: string;
  badge?: NavBadge;
  /** Shown only to members with one of these roles (the route still answers AccessState to others). */
  roles?: readonly Role[];
};

export type NavRedirect = { from: string; to: string; permanent: boolean };

const ADMINS: readonly Role[] = ['admin'];

export const NAV_GROUPS: readonly NavGroup[] = [
  { id: 'production', label: 'Produção', placement: 'main', since: 'R1', collapsible: false },
  { id: 'intake', label: 'Entrada', placement: 'main', since: 'R2', collapsible: true },
  { id: 'library', label: 'Biblioteca', placement: 'main', since: 'R2', collapsible: true },
  { id: 'distribution', label: 'Distribuição', placement: 'main', since: 'R4', collapsible: true },
  { id: 'settings', label: 'Configurações', placement: 'main', since: 'R2', collapsible: true },
  { id: 'administration', label: 'Administração', placement: 'main', since: 'R1', collapsible: true },
  { id: 'utility', label: 'Utilitário', placement: 'utility', since: 'R0', collapsible: false },
];

/** Within a group, items follow their release, so shipping a release never reorders the menu. */
export const NAV_ITEMS: readonly NavItem[] = [
  // Produção
  {
    id: 'overview',
    label: 'Visão geral',
    icon: 'LayoutDashboard',
    href: '/',
    group: 'production',
    since: 'R1',
    match: 'exact',
    features: ['F1.1', 'F1.3', 'F1.6'],
  },
  {
    id: 'productions',
    label: 'Produções',
    icon: 'LayoutList',
    href: '/productions',
    group: 'production',
    since: 'R1',
    match: 'prefix',
    badge: 'awaiting-approval',
    // Stages and piece kinds open inside a production: research and dossier (F2.6, F3.7),
    // writing and checks (F2.7, F2.8, F2.13), outline (F3.8), facets (F3.9), cuts (F4.4–F4.6, F4.8),
    // script, audio and video (F5.8, F5.10), stories and Web Story (F6.3, F6.4).
    features: [
      'F1.1', 'F1.2', 'F1.3', 'F1.4', 'F1.5', 'F1.6',
      'F2.6', 'F2.7', 'F2.8', 'F2.13', 'F3.7', 'F3.8', 'F3.9', 'F4.4', 'F4.5', 'F4.6', 'F4.8', 'F5.8', 'F5.10', 'F6.3', 'F6.4',
    ],
  },
  {
    id: 'batches',
    label: 'Lotes',
    icon: 'Boxes',
    href: '/batches',
    group: 'production',
    since: 'R7',
    match: 'prefix',
    features: ['F7.2'],
    hint: 'Vários materiais, com fila e retomada',
  },
  // Entrada
  {
    id: 'news',
    label: 'Notícias',
    icon: 'Newspaper',
    href: '/news',
    group: 'intake',
    since: 'R2',
    match: 'prefix',
    features: ['F2.1', 'F2.2', 'F2.4'],
    hint: 'Fila de notícias com triagem por IA',
  },
  {
    id: 'opportunities',
    label: 'Oportunidades',
    icon: 'Target',
    href: '/opportunities',
    group: 'intake',
    since: 'R3',
    match: 'prefix',
    features: ['F3.1', 'F3.2', 'F3.3', 'F3.4', 'F3.5', 'F3.6'],
    hint: 'Pautas Evergreen com dados de SEO',
  },
  {
    id: 'media',
    label: 'Mídia',
    icon: 'FileVideo',
    href: '/media',
    group: 'intake',
    since: 'R4',
    match: 'prefix',
    features: ['F4.1', 'F4.2', 'F4.3'],
    hint: 'Áudio e vídeo transcritos e minutados',
  },
  {
    id: 'events',
    label: 'Eventos',
    icon: 'CalendarDays',
    href: '/events',
    group: 'intake',
    since: 'R7',
    match: 'prefix',
    features: ['F7.1'],
    hint: 'Gravações do EventHub e do YouTube',
  },
  // Biblioteca
  {
    id: 'archive',
    label: 'Acervo',
    icon: 'Archive',
    href: '/archive',
    group: 'library',
    since: 'R2',
    match: 'prefix',
    features: ['F2.12', 'F2.13'],
    hint: 'Matérias publicadas que a IA consulta',
  },
  {
    id: 'quotes',
    label: 'Citações',
    icon: 'Quote',
    href: '/quotes',
    group: 'library',
    since: 'R2',
    match: 'prefix',
    features: ['F2.11', 'F4.3'],
    hint: 'Falas com autor, fonte e trecho',
  },
  {
    id: 'images',
    label: 'Imagens',
    icon: 'Image',
    href: '/images',
    group: 'library',
    since: 'R2',
    match: 'prefix',
    features: ['F2.9', 'F6.9', 'F6.10'],
    hint: 'Imagens com crédito, busca e geração',
  },
  {
    id: 'profiles',
    label: 'Perfis',
    icon: 'UsersRound',
    href: '/profiles',
    group: 'library',
    since: 'R5',
    match: 'prefix',
    features: ['F5.19', 'F5.20', 'F5.21'],
    hint: 'Avatar e voz para áudio e vídeo',
  },
  // Distribuição: the first social channel arrives with podcast cuts (F4.7).
  {
    id: 'channels',
    label: 'Canais',
    icon: 'Radio',
    href: '/channels',
    group: 'distribution',
    since: 'R4',
    match: 'prefix',
    features: ['F4.7', 'F6.1', 'F6.7', 'F6.8'],
    hint: 'Redes sociais, Spotify e WhatsApp',
  },
  {
    id: 'newsletter',
    label: 'Newsletter',
    icon: 'Mail',
    href: '/newsletter',
    group: 'distribution',
    since: 'R6',
    match: 'prefix',
    features: ['F6.5', 'F6.6'],
    hint: 'Edições e envio por e-mail',
  },
  {
    id: 'performance',
    label: 'Desempenho',
    icon: 'BarChart3',
    href: '/performance',
    group: 'distribution',
    since: 'R6',
    match: 'prefix',
    features: ['F6.2'],
    hint: 'Métricas do Analytics por conteúdo',
  },
  // Configurações
  {
    id: 'editorial-map',
    label: 'Mapa editorial',
    icon: 'Tags',
    href: '/settings/editorial-map',
    group: 'settings',
    since: 'R2',
    match: 'prefix',
    features: ['F2.3'],
    hint: 'Temas, exclusões e prioridades',
  },
  {
    id: 'writing-guide',
    label: 'Guia de escrita',
    icon: 'PenLine',
    href: '/settings/writing-guide',
    group: 'settings',
    since: 'R2',
    match: 'prefix',
    features: ['F2.5'],
    hint: 'Tom, estilo e exemplos aprovados',
  },
  // Administração. F1.7 entered R1 · Experiência (D01): read-only trail over the simulated activity
  // feed. Brand (F7.4) is a Workspaces tab and credentials (F7.5) an Integrações tab.
  {
    id: 'audit',
    label: 'Logs',
    icon: 'Shield',
    href: '/admin/audit',
    group: 'administration',
    since: 'R1',
    match: 'prefix',
    features: ['F1.7'],
    roles: AUDIT_READER_ROLES,
  },
  {
    id: 'integrations',
    label: 'Integrações',
    icon: 'Webhook',
    href: '/admin/integrations',
    group: 'administration',
    since: 'R2',
    match: 'prefix',
    features: ['F2.10', 'F3.1', 'F6.2', 'F6.6', 'F7.5'],
    hint: 'CMS, APIs e credenciais',
    roles: ADMINS,
  },
  {
    id: 'prompts',
    label: 'Prompts',
    icon: 'Terminal',
    href: '/admin/prompts',
    group: 'administration',
    since: 'R7',
    match: 'prefix',
    features: ['F7.6'],
    hint: 'Prompts por fluxo, cliente e versão',
    roles: ADMINS,
  },
  {
    id: 'workspaces',
    label: 'Workspaces',
    icon: 'Building2',
    href: '/admin/workspaces',
    group: 'administration',
    since: 'R7',
    match: 'prefix',
    features: ['F7.3', 'F7.4'],
    hint: 'Clientes, membros e marca',
    roles: ADMINS,
  },
  // "Novidades" (release notes). "Versões" now means content versions only (critique #36).
  { id: 'whats-new', label: 'Novidades', icon: 'Megaphone', href: '/whats-new', group: 'utility', since: 'R0', match: 'prefix', features: [] },
];

/** `/versions` was the prototype's release-notes route; it now redirects (`src/app/versions/page.tsx`). */
export const NAV_REDIRECTS: readonly NavRedirect[] = [{ from: '/versions', to: '/whats-new', permanent: true }];

export type PrimaryAction = { id: string; label: string; icon: IconKey; href: string; since: ReleaseId };

/** Primary actions live in PageHeader and ⌘K, not in the menu. */
export const PRIMARY_ACTIONS: readonly PrimaryAction[] = [
  { id: 'new-production', label: 'Nova produção', icon: 'Plus', href: '/productions/new', since: 'R1' },
];

export type NavSection = { group: NavGroup; items: NavItem[] };

/** A menu entry; `soon` is the "Em breve" reason of an item that ships after the release. */
export type MenuItem = NavItem & { soon?: string };

export type MenuSection = { group: NavGroup; items: MenuItem[] };

/** Who is looking at the menu; without one, role-restricted items stay hidden. */
export type NavViewer = { roles: readonly Role[] };

/** Whether a viewer may see an item (items without `roles` are for everyone). */
export function isNavItemVisible(item: Pick<NavItem, 'roles'>, viewer?: NavViewer): boolean {
  if (!item.roles?.length) return true;
  return Boolean(viewer?.roles.some((role) => item.roles?.includes(role)));
}

/**
 * "Chega na R2 · Hard News", held on one line by non-breaking spaces: the tip breaks after the
 * hint, never inside the release ("Cortes / de podcast"). The longest one fits the 240 px tip.
 */
export function arrivalOf(since: ReleaseId): string {
  return `Chega na ${since} · ${RELEASE_NAMES[since]}`.replace(/ /g, '\u00a0');
}

/** The "Em breve" reason: what the screen will do, then when it arrives. */
export function soonReason(item: Pick<NavItem, 'hint' | 'since'>): string {
  return item.hint ? `${item.hint}. ${arrivalOf(item.since)}` : arrivalOf(item.since);
}

function sections<T extends NavItem>(groups: readonly NavGroup[], items: readonly T[]): { group: NavGroup; items: T[] }[] {
  return groups
    .map((group) => ({ group, items: items.filter((item) => item.group === group.id) }))
    .filter((section) => section.items.length > 0);
}

/**
 * The sidebar: every group and item of R1–R7 the viewer may see, in registry order. Items released
 * in `release` navigate; later ones carry `soon` and never get a link.
 */
export function menuFor(release: ReleaseId = CURRENT_RELEASE, viewer?: NavViewer): MenuSection[] {
  const items = NAV_ITEMS.filter((item) => isNavItemVisible(item, viewer)).map<MenuItem>((item) =>
    isReleased(item.since, release) ? item : { ...item, soon: soonReason(item) },
  );
  return sections(NAV_GROUPS, items);
}

/** Released destinations only (⌘K "Ir para"): groups with at least one visible item, in registry order. */
export function navigationFor(release: ReleaseId = CURRENT_RELEASE, viewer?: NavViewer): NavSection[] {
  const items = availableIn(NAV_ITEMS, release).filter((item) => isNavItemVisible(item, viewer));
  return sections(availableIn(NAV_GROUPS, release), items);
}

function matches(item: NavItem, pathname: string): boolean {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  if (item.match === 'exact') return path === item.href;
  return path === item.href || path.startsWith(`${item.href}/`);
}

/** The menu item to highlight for a pathname (longest matching href wins); "Em breve" items never match. */
export function activeNavItem(pathname: string, release: ReleaseId = CURRENT_RELEASE): NavItem | undefined {
  return availableIn(NAV_ITEMS, release)
    .filter((item) => matches(item, pathname))
    .sort((a, b) => b.href.length - a.href.length)[0];
}
