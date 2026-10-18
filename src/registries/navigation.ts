import { AUDIT_READER_ROLES } from '../domain/audit.ts';
import { CAPABILITY_ROLES } from '../domain/permissions.ts';
import type { Capability } from '../domain/permissions.ts';
import type { Role } from '../domain/workspace.ts';
import type { IconKey } from './icons.ts';
import { availableIn, CURRENT_RELEASE, isReleased, RELEASE_NAMES, releaseIndex } from './release.ts';
import type { ReleaseId } from './release.ts';

/**
 * Menu registry (PLAN §2, hierarchy D9). The sidebar (`menuFor`) puts what works today on top, in
 * one unlabeled section, then ONE collapsed group
 * "Em breve" with every item of a later release in release order (no link: their routes keep
 * answering 404 until the release ships), and Logs, Prompts and Versões at the bottom. ⌘K, the active item and
 * the trail use only released items (`navigationFor`, `activeNavItem`). Role filtering comes
 * first: nobody sees an item they will not have access to, not even as "Em breve".
 * `NAV_GROUPS` stays the product map (where an item belongs once its release ships; ⌘K keywords).
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
  /** The label folds the group. */
  collapsible: boolean;
  /** A collapsible group starts open unless this is `false`. */
  defaultOpen?: boolean;
};

/**
 * The sections the sidebar draws: released items, the "Em breve" group, the bottom utilities. From
 * R2 the released items split into the day's work, "Biblioteca" and "Configurações".
 */
export type MenuGroupId = 'main' | 'library' | 'settings' | 'soon' | 'utility';

export type MenuGroup = {
  id: MenuGroupId;
  /** No label: the released items read as one list. */
  label?: string;
  placement: NavPlacement;
  collapsible: boolean;
  /** A collapsible group starts open unless this is `false`. */
  defaultOpen?: boolean;
};

/** Live counters the shell may attach to an item (NavItem.count in the DS Sidebar). */
export type NavBadge = 'awaiting-approval';

export type NavItem = {
  id: string;
  label: string;
  icon: IconKey;
  href: string;
  group: NavGroupId;
  /** Override the sidebar placement while keeping the product group used by ⌘K. */
  placement?: NavPlacement;
  /** Keep implemented destinations out of navigation until their product scope is approved. */
  hidden?: boolean;
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

const ADMINS: readonly Role[] = CAPABILITY_ROLES['pipeline.edit'];
/** Who decides at a gate (article: approver; carousel: creative reviewer; admin both). */
const DECIDERS: readonly Role[] = ['approver', 'creative_reviewer', 'admin'];

export const NAV_GROUPS: readonly NavGroup[] = [
  { id: 'production', label: 'Produção', placement: 'main', since: 'R1', collapsible: false },
  { id: 'intake', label: 'Entrada', placement: 'main', since: 'R2', collapsible: true },
  { id: 'library', label: 'Biblioteca', placement: 'main', since: 'R1', collapsible: true },
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
    label: 'Início',
    icon: 'Inbox',
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
    // Stages and piece kinds open inside a production: research and dossier (F2.6, F3.7),
    // writing and checks (F2.7, F2.8, F2.13), outline (F3.8), facets (F3.9), cuts (F4.4–F4.6, F4.8),
    // script, audio and video (F5.8, F5.10), stories and Web Story (F6.3, F6.4).
    features: [
      'F1.1', 'F1.2', 'F1.3', 'F1.4', 'F1.5', 'F1.6',
      'F2.6', 'F2.7', 'F2.8', 'F2.13', 'F3.7', 'F3.8', 'F3.9', 'F4.4', 'F4.5', 'F4.6', 'F4.8', 'F5.8', 'F5.10', 'F6.3', 'F6.4',
    ],
  },
  // The queue of whoever decides at a gate (D9, R5): its count is the viewer's "Para aprovar".
  {
    id: 'approvals',
    label: 'Aprovações',
    icon: 'BadgeCheck',
    href: '/approvals',
    group: 'production',
    since: 'R1',
    match: 'prefix',
    features: ['F1.3', 'F1.6'],
    badge: 'awaiting-approval',
    hidden: true,
    roles: DECIDERS,
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
  // Biblioteca. Carousel models arrive with F1.5 (D07): the library the studio picks from.
  {
    id: 'templates',
    label: 'Modelos',
    icon: 'LayoutTemplate',
    href: '/library/templates',
    group: 'library',
    since: 'R1',
    match: 'prefix',
    features: ['F1.5'],
  },
  {
    id: 'images',label: 'Imagens',icon: 'Image',href: '/images',group: 'library',since: 'R1',match: 'prefix',
    hidden: true,
    features: ['F1.2','F2.9','F6.9','F6.10'],hint: 'Fotos editoriais com origem e licença',
  },
  { id: 'banners',label: 'Banners',icon: 'LayoutTemplate',href: '/banners',group: 'library',since: 'R1',match: 'prefix',hidden: true,features: ['F1.5'],hint: 'Composições editoriais com exportação local' },
  {
    id: 'quotes',
    hidden: true,
    label: 'Citações',
    icon: 'Quote',
    href: '/quotes',
    group: 'library',
    since: 'R1',
    match: 'prefix',
    features: ['F1.2', 'F2.11', 'F4.3'],
    hint: 'Falas com autor, fonte e trecho',
  },
  {
    id: 'archive',label: 'Acervo',icon: 'Archive',href: '/archive',group: 'library',since: 'R2',match: 'prefix',
    features: ['F2.12','F2.13'],hint: 'Matérias publicadas que a IA consulta',
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
    placement: 'utility',
    since: 'R1',
    match: 'prefix',
    features: ['F1.7'],
    roles: AUDIT_READER_ROLES,
  },
  {
    id: 'prompts',
    label: 'Prompts',
    icon: 'Terminal',
    href: '/config',
    group: 'administration',
    placement: 'utility',
    since: 'R1',
    match: 'prefix',
    // Local generation controls for F1.2; not a claim of complete multiworkspace F7.6.
    features: ['F1.2', 'F7.6'],
    hint: 'Engenharia de prompts e orquestração do motor local',
    roles: ADMINS,
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
  // Product version history keeps its existing release-notes route.
  { id: 'whats-new', label: 'Versões', icon: 'Megaphone', href: '/whats-new', group: 'utility', since: 'R0', match: 'prefix', features: [] },
];

/** `/versions` was the prototype's release-notes route; it now redirects (`src/app/versions/page.tsx`). */
export const NAV_REDIRECTS: readonly NavRedirect[] = [{ from: '/versions', to: '/whats-new', permanent: true }];

/** `capability`: only a member who holds it sees the action (an approver never sees "Nova produção"). */
export type PrimaryAction = { id: string; label: string; icon: IconKey; href: string; since: ReleaseId; capability: Capability };

/** Primary actions live in PageHeader and ⌘K, not in the menu. */
export const PRIMARY_ACTIONS: readonly PrimaryAction[] = [
  { id: 'new-production', label: 'Nova produção', icon: 'Plus', href: '/productions/new', since: 'R1', capability: 'production.create' },
];

export type NavSection = { group: NavGroup; items: NavItem[] };

/** A menu entry; `soon` is the "Em breve" reason of an item that ships after the release. */
export type MenuItem = NavItem & { soon?: string };

export type MenuSection = { group: MenuGroup; items: MenuItem[] };

/** The sidebar's sections (D9): "Em breve" is ONE group, collapsed on arrival. */
export const MENU_GROUPS: Readonly<Record<MenuGroupId, MenuGroup>> = {
  main: { id: 'main', placement: 'main', collapsible: false },
  library: { id: 'library', label: 'Biblioteca', placement: 'main', collapsible: false },
  settings: { id: 'settings', label: 'Configurações', placement: 'main', collapsible: false },
  soon: { id: 'soon', label: 'Em breve', placement: 'main', collapsible: true, defaultOpen: false },
  utility: { id: 'utility', placement: 'utility', collapsible: false },
};

/** Who is looking at the menu; without one, role-restricted items stay hidden. */
export type NavViewer = { roles: readonly Role[] };

/** Only the UI demonstration expands navigation; domain/worker release gates stay on R1. */
export type NavigationOptions = { previewR2?: boolean };
/** Library screens R1 kept out of the menu (Imagens, Citações) open with the Hard News release. */
const LIBRARY_FROM_R2 = new Set(['images', 'quotes']);

function navigationEntries(options: NavigationOptions, release: ReleaseId = CURRENT_RELEASE): readonly NavItem[] {
  if (!options.previewR2 && isReleased('R2', release)) {
    return NAV_ITEMS.map((item) => (LIBRARY_FROM_R2.has(item.id) ? { ...item, hidden: false } : item));
  }
  if (!options.previewR2) return NAV_ITEMS;
  return NAV_ITEMS.map(item => item.id === 'images' || item.id === 'quotes'
    ? { ...item, hidden: false, since: 'R2' as const }
    : item.id === 'integrations' ? { ...item, label: 'CMS do portal' } : item);
}

/** Scope is checked before roles; approved items without `roles` are for everyone. */
export function isNavItemVisible(item: Pick<NavItem, 'roles' | 'hidden'>, viewer?: NavViewer): boolean {
  if (item.hidden) return false;
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

function placementOf(item: Pick<NavItem, 'group' | 'placement'>): NavPlacement {
  return item.placement ?? NAV_GROUPS.find((group) => group.id === item.group)?.placement ?? 'main';
}

/**
 * The sidebar for a viewer (D9): the released items in registry order (one unlabeled section),
 * then "Em breve" with every later item the viewer may see in release order (registry order
 * within a release; each keeps its reason and never gets a link), then Logs, Prompts and Versões.
 * Empty sections are left out.
 */
export function menuFor(release: ReleaseId = CURRENT_RELEASE, viewer?: NavViewer, options: NavigationOptions = {}): MenuSection[] {
  if (options.previewR2) release = 'R2';
  const visible = navigationEntries(options, release).filter((item) => isNavItemVisible(item, viewer));
  const released = visible.filter((item) => isReleased(item.since, release));
  if (options.previewR2) {
    const order = ['overview', 'productions', 'templates', 'news', 'images', 'quotes', 'archive', 'editorial-map', 'writing-guide', 'integrations'];
    released.sort((a, b) => (order.indexOf(a.id) < 0 ? 99 : order.indexOf(a.id)) - (order.indexOf(b.id) < 0 ? 99 : order.indexOf(b.id)));
  }
  const soon = visible
    .filter((item) => !isReleased(item.since, release))
    .map((item, order) => ({ item, order }))
    .sort((a, b) => releaseIndex(a.item.since) - releaseIndex(b.item.since) || a.order - b.order)
    .map<MenuItem>(({ item }) => ({ ...item, soon: soonReason(item) }));
  if (!options.previewR2 && isReleased('R2', release)) return sectionedMenu(released, soon);
  const result: MenuSection[] = [
    { group: MENU_GROUPS.main, items: released.filter((item) => placementOf(item) === 'main') },
    { group: MENU_GROUPS.soon, items: soon },
    { group: MENU_GROUPS.utility, items: released.filter((item) => placementOf(item) === 'utility') },
  ];
  return result.filter((section) => section.items.length > 0);
}

/** Where a released item sits from R2: the day's work, the library, the settings, the bottom. */
function menuGroupOf(item: NavItem): MenuGroupId {
  if (placementOf(item) === 'utility') return 'utility';
  if (item.group === 'library') return 'library';
  if (item.group === 'settings' || item.group === 'administration') return 'settings';
  return 'main';
}

/** Início first, then the incoming news, then the rest of the work, as a writer's day reads. */
function workRank(item: NavItem): number {
  if (item.id === 'overview') return 0;
  return item.group === 'intake' ? 1 : 2;
}

/**
 * R2 menu: Início, Notícias and Produções on top, then "Biblioteca" and "Configurações" as two
 * short labelled sections, "Em breve" collapsed, and the utilities at the bottom.
 */
function sectionedMenu(released: readonly NavItem[], soon: readonly MenuItem[]): MenuSection[] {
  const of = (id: MenuGroupId) => released.filter((item) => menuGroupOf(item) === id);
  const work = of('main').map((item, order) => ({ item, order }))
    .sort((a, b) => workRank(a.item) - workRank(b.item) || a.order - b.order)
    .map(({ item }) => item);
  const result: MenuSection[] = [
    { group: MENU_GROUPS.main, items: work },
    { group: MENU_GROUPS.library, items: of('library') },
    { group: MENU_GROUPS.settings, items: of('settings') },
    { group: MENU_GROUPS.soon, items: [...soon] },
    { group: MENU_GROUPS.utility, items: of('utility') },
  ];
  return result.filter((section) => section.items.length > 0);
}

/** Released destinations only (⌘K "Ir para"): groups with at least one visible item, in registry order. */
export function navigationFor(release: ReleaseId = CURRENT_RELEASE, viewer?: NavViewer, options: NavigationOptions = {}): NavSection[] {
  if (options.previewR2) release = 'R2';
  const items = availableIn(navigationEntries(options, release), release).filter((item) => isNavItemVisible(item, viewer));
  return sections(availableIn(NAV_GROUPS, release), items);
}

function matches(item: NavItem, pathname: string): boolean {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  if (item.match === 'exact') return path === item.href;
  return path === item.href || path.startsWith(`${item.href}/`);
}

/** The menu item to highlight for a pathname (longest matching href wins); "Em breve" items never match. */
export function activeNavItem(pathname: string, release: ReleaseId = CURRENT_RELEASE, options: NavigationOptions = {}): NavItem | undefined {
  if (options.previewR2) release = 'R2';
  return availableIn(navigationEntries(options, release), release)
    .filter((item) => matches(item, pathname))
    .sort((a, b) => b.href.length - a.href.length)[0];
}
