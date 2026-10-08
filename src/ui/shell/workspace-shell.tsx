'use client';

import { useCallback, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
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
import { activeNavItem, menuFor, type MenuItem } from '@/registries';
import { useProductions, useSession } from '@/state';
import { iconFor } from '../icons';
import { NEW_PRODUCTION_HREF, PRODUCTIONS_HREF } from '../routes';
import { ShellAccount } from './account';
import { BreadcrumbProvider, useDeclaredBreadcrumb } from './breadcrumb';
import { useClientLinks } from './client-links';
import { ShellCommandPalette } from './command-palette';
import { CommandRegistryProvider } from './command-registry';
import { FocusModeProvider, useFocusMode } from './focus-mode';
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
 * Every stage of a production (Material, studios, review, Entrega) keeps one menu preference,
 * collapsed to the rail by default: the work needs the width, and moving between stages never
 * swaps the menu (B02).
 */
const WORKBENCH_COLLAPSED_KEY = 'reporter:ui:sidebar-collapsed-workbench';
const PRODUCTION_ROUTE = /^\/productions\/[^/]+(?:\/.*)?$/;
/**
 * Every stage of a production is a docked work area (B02): studios, review gates, Material and
 * Entrega share one header line at one place, edge to edge, no page gutter or max width.
 */
const DOCKED_ROUTE = /^\/productions\/[^/]+\/[^/]+(?:\/review)?$/;

/** Trail when the screen did not declare one: the menu item, or "Produções › Nova produção". */
function defaultCrumbs(pathname: string): Crumb[] {
  if (pathname === NEW_PRODUCTION_HREF) return [{ label: 'Produções', href: PRODUCTIONS_HREF }, { label: 'Nova produção' }];
  if (pathname.startsWith(`${PRODUCTIONS_HREF}/`)) return [{ label: 'Produções', href: PRODUCTIONS_HREF }];
  const item = activeNavItem(pathname);
  return [{ label: item?.label ?? 'Reporter IA' }];
}

/** Items of a later release keep their place in the menu as "Em breve", with no link (their routes are 404). */
function toNavItem(item: MenuItem, awaitingApproval: number): NavItem {
  if (item.soon) return { id: item.id, label: item.label, icon: iconFor(item.icon), soon: { reason: item.soon } };
  const nav: NavItem = { id: item.id, label: item.label, icon: iconFor(item.icon), href: item.href };
  if (item.badge === 'awaiting-approval' && awaitingApproval > 0) {
    nav.count = awaitingApproval;
    nav.countTone = 'accent';
  }
  return nav;
}

function ShellFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  useClientLinks();
  const { focus } = useFocusMode();
  const declared = useDeclaredBreadcrumb();
  const workbench = PRODUCTION_ROUTE.test(pathname) && pathname !== NEW_PRODUCTION_HREF;
  const docked = workbench && DOCKED_ROUTE.test(pathname);
  const [pageCollapsed, setPageCollapsed] = usePersistentFlag(COLLAPSED_KEY);
  const [workbenchCollapsed, setWorkbenchCollapsed] = usePersistentFlag(WORKBENCH_COLLAPSED_KEY, true);
  const collapsed = workbench ? workbenchCollapsed : pageCollapsed;
  const setCollapsed = workbench ? setWorkbenchCollapsed : setPageCollapsed;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  const productions = useProductions(LIST_FILTER, LIST_PAGE);
  const items = productions.data?.items ?? NO_PRODUCTIONS;
  const awaitingApproval = productions.data?.counts.in_review ?? 0;
  // Role-restricted items (Administração › Logs) appear once the acting member is known; the
  // session answer keeps its object while unchanged, so `roles` is a stable dependency.
  const roles = useSession().data?.current?.roles;

  // The whole roadmap map (R1–R7): what this release ships navigates, the rest shows "Em breve".
  const { groups, utilities, hrefs } = useMemo(() => {
    const sections = menuFor(undefined, roles ? { roles } : undefined);
    const main = sections.filter((section) => section.group.placement === 'main');
    const utility = sections.filter((section) => section.group.placement === 'utility');
    return {
      groups: main.map<NavGroup>((section) => ({
        id: section.group.id,
        label: section.group.label,
        collapsible: section.group.collapsible,
        items: section.items.map((item) => toNavItem(item, awaitingApproval)),
      })),
      utilities: utility.flatMap((section) => section.items.map((item) => toNavItem(item, awaitingApproval))),
      hrefs: new Map(
        sections.flatMap((section) => section.items.filter((item) => !item.soon).map((item) => [item.id, item.href] as const)),
      ),
    };
  }, [awaitingApproval, roles]);

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
        layout={focus ? 'drawer' : 'auto'}
        collapsed={collapsed}
        bleed={docked}
        sidebar={
          <Sidebar
            product={<ProductMark name="Reporter IA" caption="Content Ventures" />}
            search={<SidebarSearch onOpen={openPalette} label="Buscar" bindShortcut />}
            groups={groups}
            utilities={utilities}
            active={activeNavItem(pathname)?.id}
            onNavigate={onNavigate}
            account={<ShellAccount />}
          />
        }
        topbar={
          <TopBar
            breadcrumb={crumbs}
            onToggleSidebar={focus ? undefined : () => setCollapsed(!collapsed)}
            notifications={<ShellNotifications />}
          />
        }
      >
        {/* On a production the notice lives in the production header (B02: no band above a docked studio). */}
        {workbench ? null : <OtherTabNotice />}
        {children}
      </AppShell>
      <ShellCommandPalette open={paletteOpen} onClose={closePalette} productions={items} loading={productions.status === 'loading'} />
      <RunOutcomeToasts productions={items} />
    </CommandRegistryProvider>
  );
}

/**
 * The workspace shell: menu from the navigation registry (R1–R7, later releases as "Em breve"),
 * ⌘K, trail, bell, account, focus mode and the run-outcome toasts. Mounted once by `app/(workspace)/layout.tsx`.
 */
export function WorkspaceShell({ children }: { children: ReactNode }) {
  return (
    <BreadcrumbProvider>
      <FocusModeProvider>
        <ShellFrame>{children}</ShellFrame>
      </FocusModeProvider>
    </BreadcrumbProvider>
  );
}
