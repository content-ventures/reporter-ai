'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  AppShell,
  ProductMark,
  Sidebar,
  SidebarSearch,
  TopBar,
  type Crumb,
  type NavGroup,
  type NavItem,
} from '@content-ventures/design-system/v3';
import type { ProductionListFilter, ProductionListItem } from '@/ports';
import { activeNavItem, menuFor, type MenuItem, type MenuSection } from '@/registries';
import { useApprovals, useProductions, useSession } from '@/state';
import { iconFor } from '../icons';
import { NEW_PRODUCTION_HREF, PRODUCTIONS_HREF } from '../routes';
import { ShellAccount } from './account';
import { BreadcrumbProvider, useDeclaredBreadcrumb } from './breadcrumb';
import { useClientLinks } from './client-links';
import { ShellCommandPalette } from './command-palette';
import { CommandRegistryProvider } from './command-registry';
import { ShellNotifications } from './notifications';
import { OtherTabNotice } from './other-tab-notice';
import { requestLeave } from './leave-guard';
import { usePersistentFlag } from './preference';
import { RunOutcomeToasts } from './run-outcome-toasts';

const LIST_FILTER: ProductionListFilter = { sort: 'updated_desc' };
const LIST_PAGE = { page: 1, size: 50 };
const NO_PRODUCTIONS: readonly ProductionListItem[] = [];
const COLLAPSED_KEY = 'reporter:ui:sidebar-collapsed';
/**
 * Inside a production (every stage, not Nova produção) the app menu disappears (D2, P1, R7): no
 * sidebar, no top bar, no trail, no bell. The production header's "← Produções" and journey menu
 * orient the writer; ⌘K still works.
 */
const IMMERSIVE_ROUTE = /^\/productions\/(?!new(?:[/?#]|$))[^/]+(?:\/.*)?$/;
/**
 * Every stage of a production is a docked work area (B02): studios, review, Material and Entrega
 * share one header line at one place, edge to edge, no page gutter or max width.
 */
const DOCKED_ROUTE = /^\/productions\/[^/]+\/[^/]+(?:\/review)?$/;

/** Trail when the screen did not declare one: the menu item, or "Produções › Nova produção". */
function defaultCrumbs(pathname: string): Crumb[] {
  if (pathname === NEW_PRODUCTION_HREF) return [{ label: 'Produções', href: PRODUCTIONS_HREF }, { label: 'Nova produção' }];
  if (pathname.startsWith(`${PRODUCTIONS_HREF}/`)) return [{ label: 'Produções', href: PRODUCTIONS_HREF }];
  const item = activeNavItem(pathname);
  return [{ label: item?.label ?? 'Reporter IA' }];
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
  const pathname = usePathname();
  const router = useRouter();
  useClientLinks();
  const declared = useDeclaredBreadcrumb();
  const immersive = IMMERSIVE_ROUTE.test(pathname);
  const docked = immersive && DOCKED_ROUTE.test(pathname);
  const [collapsed, setCollapsed] = usePersistentFlag(COLLAPSED_KEY);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  usePaletteShortcut(openPalette);

  const productions = useProductions(LIST_FILTER, LIST_PAGE);
  const items = productions.data?.items ?? NO_PRODUCTIONS;
  // Role-restricted items (Aprovações, Logs) appear once the acting member is known; the session
  // answer keeps its object while unchanged, so `roles` is a stable dependency.
  const roles = useSession().data?.current?.roles;
  const sections = useMemo(() => menuFor(undefined, roles ? { roles } : undefined), [roles]);
  // Only someone who decides at a gate has an Aprovações item, so only they ask for the queue.
  const decides = sections.some((section) => section.items.some((item) => item.badge === 'awaiting-approval' && !item.soon));
  const approvals = useApprovals(decides ? 'to_approve' : null);
  const awaitingApproval = decides ? (approvals.data?.counts.to_approve ?? 0) : 0;

  // What works today on top, the later releases in ONE collapsed "Em breve" group, Novidades below.
  const { groups, utilities, hrefs } = useMemo(() => {
    const main = sections.filter((section) => section.group.placement === 'main');
    const utility = sections.filter((section) => section.group.placement === 'utility');
    return {
      groups: main.map((section) => toNavGroup(section, awaitingApproval)),
      utilities: utility.flatMap((section) => section.items.map((item) => toNavItem(item, awaitingApproval))),
      hrefs: new Map(
        sections.flatMap((section) => section.items.filter((item) => !item.soon).map((item) => [item.id, item.href] as const)),
      ),
    };
  }, [awaitingApproval, sections]);

  const onNavigate = useCallback(
    (id: string, event: MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => {
      const href = hrefs.get(id);
      if (!href || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (requestLeave(href)) router.push(href);
    },
    [hrefs, router],
  );

  const crumbs = declared ?? defaultCrumbs(pathname);

  return (
    <CommandRegistryProvider onOpenPalette={openPalette}>
      <AppShell
        layout={immersive ? 'immersive' : 'auto'}
        collapsed={!immersive && collapsed}
        bleed={docked}
        sidebar={
          immersive ? null : (
            <Sidebar
              product={<ProductMark name="Reporter IA" caption="Content Ventures" />}
              search={<SidebarSearch onOpen={openPalette} label="Buscar" />}
              groups={groups}
              utilities={utilities}
              active={activeNavItem(pathname)?.id}
              onNavigate={onNavigate}
              account={<ShellAccount />}
            />
          )
        }
        topbar={
          immersive ? undefined : (
            <TopBar breadcrumb={crumbs} onToggleSidebar={() => setCollapsed(!collapsed)} notifications={<ShellNotifications />} />
          )
        }
      >
        {/* On a production the notice lives in the production header (B02: no band above a docked studio). */}
        {immersive ? null : <OtherTabNotice />}
        {children}
      </AppShell>
      <ShellCommandPalette open={paletteOpen} onClose={closePalette} productions={items} loading={productions.status === 'loading'} />
      <RunOutcomeToasts productions={items} />
    </CommandRegistryProvider>
  );
}

/**
 * The workspace shell: menu from the navigation registry (released items, then "Em breve"
 * collapsed), ⌘K on every route, trail, bell, account and the run-outcome toasts. Inside a
 * production it steps aside (immersive). Mounted once by `app/(workspace)/layout.tsx`.
 */
export function WorkspaceShell({ children }: { children: ReactNode }) {
  return (
    <BreadcrumbProvider>
      <ShellFrame>{children}</ShellFrame>
    </BreadcrumbProvider>
  );
}
