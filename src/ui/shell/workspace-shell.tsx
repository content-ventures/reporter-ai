'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { workspaceAddress } from '../../domain/workspace-address.ts';
import {
  AppShell,
  Badge,
  Sidebar,
  SidebarSearch,
  TopBar,
  type Crumb,
  type NavGroup,
  type NavItem,
} from '@content-ventures/design-system/v3';
import { productionTrail } from '@/features/production/trail';
import type { ProductionListFilter, ProductionListItem } from '@/ports';
import { activeNavItem, menuFor, type MenuItem, type MenuSection } from '@/registries';
import { useApprovals, useProductions, useRuntime, useSession } from '@/state';
import { iconFor } from '../icons';
import { ReporterBrand } from '../reporter-brand';
import { PRODUCT_NAME } from '@/lib/brand';
import { PermissionDialogHost } from '../permission-dialog';
import { R2_NAVIGATION, isR2DemoPath } from '../r2-preview';
import { NEW_PRODUCTION_HREF, productionRoute, PRODUCTIONS_HREF } from '../routes';
import { ShellAccount } from './account';
import { BreadcrumbProvider, useDeclaredBreadcrumb } from './breadcrumb';
import { useClientLinks } from './client-links';
import { ShellCommandPalette } from './command-palette';
import { CommandRegistryProvider } from './command-registry';
import { ShellNotifications } from './notifications';
import { OtherTabNotice } from './other-tab-notice';
import { requestLeave } from './leave-guard';
import { SIDEBAR_COLLAPSED_KEY, usePersistentFlag } from './preference';
import { RunOutcomeToasts } from './run-outcome-toasts';
import {WorkspaceSwitcher} from './workspace-switcher';
import {rememberWorkspace} from '@/state/workspace-preference';
import {useWorkspaceRouter as useRouter,useWorkspaceHref} from '../workspace-navigation';

const LIST_FILTER: ProductionListFilter = { sort: 'updated_desc' };
const LIST_PAGE = { page: 1, size: 50 };
const NO_PRODUCTIONS: readonly ProductionListItem[] = [];
/**
 * Production stages use a docked work area (B02) inside the app shell: studios, review, Material
 * and Entrega share one header line at one place, edge to edge, no page gutter or max width.
 */
const DOCKED_ROUTE = /^\/productions\/[^/]+\/[^/]+(?:\/review)?$/;
/** From R2 the news desk is a work area too: the queue and the news fill the window. */
const R2_DOCKED_ROUTE = /^\/news$/;

/**
 * Trail when the screen did not declare one: the menu item, "Produções › Nova produção", or on a
 * production stage "Produções › <etapa>" (the frame inserts the title once the production loads;
 * an error or a restricted production keeps this one). `productionTrail` is the one import from
 * `src/features` here: a pure module with relative imports only.
 */
function defaultCrumbs(pathname: string): Crumb[] {
  if (pathname === NEW_PRODUCTION_HREF) return [{ label: 'Produções', href: PRODUCTIONS_HREF }, { label: 'Nova produção' }];
  if (pathname.startsWith(`${PRODUCTIONS_HREF}/`)) {
    return productionTrail(productionRoute(pathname.split('/').slice(3)), { productions: PRODUCTIONS_HREF });
  }
  const item = activeNavItem(pathname, undefined, R2_NAVIGATION);
  return [{ label: item?.label ?? PRODUCT_NAME }];
}

/** Items of a later release keep their reason under "Em breve", with no link (their routes are 404). */
function toNavItem(item: MenuItem, awaitingApproval: number): NavItem {
  if (item.soon) return { id: item.id, label: item.label, icon: iconFor(item.icon), soon: { reason: item.soon } };
  const nav: NavItem = { id: item.id, label: item.label, icon: iconFor(item.icon), href: item.href };
  // "Aprovações 2": the viewer's "Para aprovar" (the same number as the Início sentence and group).
  if (item.badge === 'awaiting-approval' && awaitingApproval > 0) {
    nav.count = awaitingApproval;
    nav.countTone = 'accent';
  }
  return nav;
}

function toNavGroup(section: MenuSection, awaitingApproval: number): NavGroup {
  const group: NavGroup = {
    id: section.group.id,
    collapsible: section.group.collapsible,
    items: section.items.map((item) => toNavItem(item, awaitingApproval)),
  };
  if (section.group.label) group.label = section.group.label;
  if (section.group.defaultOpen !== undefined) group.defaultOpen = section.group.defaultOpen;
  return group;
}

/** ⌘K / Ctrl+K opens the palette on every route, with or without the sidebar's search button. */
function usePaletteShortcut(open: () => void): void {
  const latest = useRef(open);
  useEffect(() => {
    latest.current = open;
  });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        latest.current();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function ShellFrame({ children }: { children: ReactNode }) {
  const routePath = usePathname();
  const pathname = workspaceAddress(routePath)?.path ?? routePath;
  const router = useRouter();
  const hrefForWorkspace=useWorkspaceHref();
  useClientLinks();
  const declared = useDeclaredBreadcrumb();
  const docked = DOCKED_ROUTE.test(pathname) || R2_DOCKED_ROUTE.test(pathname);
  // Each connected capability removes the demonstration badge from its own screens (none while loading).
  const runtime = useRuntime();
  const libraries = runtime.status === 'loading' || Boolean(runtime.runtime?.visuals);
  const news = runtime.status === 'loading' || Boolean(runtime.runtime?.news);
  const editorialSettings = runtime.status === 'loading' || Boolean(runtime.runtime?.pipeline);
  const [collapsed, setCollapsed] = usePersistentFlag(SIDEBAR_COLLAPSED_KEY);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  usePaletteShortcut(openPalette);

  const productions = useProductions(LIST_FILTER, LIST_PAGE);
  const items = productions.data?.items ?? NO_PRODUCTIONS;
  // Role-restricted items (Aprovações, Logs) appear once the acting member is known; the session
  // answer keeps its object while unchanged, so `roles` is a stable dependency.
  const session=useSession();
  const roles = session.data?.current?.roles;
  useEffect(()=>{const data=session.data;
    if(data?.navigation?.enabled&&workspaceAddress(routePath)?.slug===data.workspace.slug)rememberWorkspace(data.navigation.accountId,{workspaceId:data.workspace.id,slug:data.workspace.slug});
  },[session.data,routePath]);
  const sections = useMemo(() => menuFor(undefined, roles ? { roles } : undefined, R2_NAVIGATION), [roles]);
  // Only someone who decides at a gate has an Aprovações item, so only they ask for the queue.
  const decides = sections.some((section) => section.items.some((item) => item.badge === 'awaiting-approval' && !item.soon));
  const approvals = useApprovals(decides ? 'to_approve' : null);
  const awaitingApproval = decides ? (approvals.data?.counts.to_approve ?? 0) : 0;

  // Released work on top, one collapsed "Em breve" group, then Logs, Prompts and Versões below.
  const { groups, utilities, hrefs } = useMemo(() => {
    const main = sections.filter((section) => section.group.placement === 'main');
    const utility = sections.filter((section) => section.group.placement === 'utility');
    return {
      groups: main.map((section) => {const group=toNavGroup(section,awaitingApproval);return{...group,items:group.items.map(item=>({...item,...(item.href?{href:hrefForWorkspace(item.href)}:{})}))};}),
      utilities: utility.flatMap((section) => section.items.map((item) => {const nav=toNavItem(item,awaitingApproval);return{...nav,...(nav.href?{href:hrefForWorkspace(nav.href)}:{})};})),
      hrefs: new Map(
        sections.flatMap((section) => section.items.filter((item) => !item.soon).map((item) => [item.id, hrefForWorkspace(item.href)] as const)),
      ),
    };
  }, [awaitingApproval, sections,hrefForWorkspace]);

  const onNavigate = useCallback(
    (id: string, event: MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => {
      const href = hrefs.get(id);
      if (!href || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (requestLeave(href)) router.push(href);
    },
    [hrefs, router],
  );

  const crumbs = (declared ?? defaultCrumbs(pathname)).map(crumb=>({...crumb,...(crumb.href?{href:hrefForWorkspace(crumb.href)}:{})}));
  if(routePath==='/'&&session.data?.navigation?.enabled)return<WorkspaceEntry/>;

  return (
    <CommandRegistryProvider onOpenPalette={openPalette}>
      <AppShell
        layout="auto"
        collapsed={collapsed}
        bleed={docked}
        sidebar={(
          <Sidebar
            product={<ReporterBrand endorsed />}
            switcher={<WorkspaceSwitcher/>}
            search={<SidebarSearch onOpen={openPalette} label="Buscar" />}
            groups={groups}
            utilities={utilities}
            active={activeNavItem(pathname, undefined, R2_NAVIGATION)?.id}
            onNavigate={onNavigate}
            account={<ShellAccount />}
          />
        )}
        topbar={<TopBar actions={isR2DemoPath(pathname, libraries, news, editorialSettings) ? <Badge tone="amber">Demo</Badge> : undefined} breadcrumb={crumbs} onToggleSidebar={() => setCollapsed(!collapsed)} notifications={<ShellNotifications />} />}
      >
        {/* On a docked production the notice lives in its own header, not above the studio. */}
        {docked ? null : <OtherTabNotice />}
        {children}
      </AppShell>
      <ShellCommandPalette open={paletteOpen} onClose={closePalette} productions={items} loading={productions.status === 'loading'} />
      <RunOutcomeToasts productions={items} />
      <PermissionDialogHost />
    </CommandRegistryProvider>
  );
}
function WorkspaceEntry(){
  const router=useRouter();
  useEffect(()=>router.replace('/workspaces?entry=1'),[router]);
  return null;
}

/**
 * The workspace shell: menu from the navigation registry (released items, then "Em breve"
 * collapsed), ⌘K on every route, trail (the only page navigation), bell, account and the
 * run-outcome toasts. Inside a production it docks the work area edge to edge. Mounted once by
 * `app/(workspace)/layout.tsx`.
 */
export function WorkspaceShell({ children }: { children: ReactNode }) {
  return (
    <BreadcrumbProvider>
      <ShellFrame>{children}</ShellFrame>
    </BreadcrumbProvider>
  );
}
