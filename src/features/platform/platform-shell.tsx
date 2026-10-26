'use client';

import { useCallback, useMemo, type MouseEvent, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AppShell, Badge, Sidebar, SidebarAccount, ThemeV3, TopBar, type NavGroup, type NavItem } from '@content-ventures/design-system/v3';
import { ArrowUpRight, ChartNoAxesColumn, LayoutDashboard, LogOut, ScrollText, Users,Building2 } from '@content-ventures/design-system/v3/icons';
import { authClient } from '@/lib/auth-client';
import { usePlatform, usePlatformDirectory, usePlatformOperator,usePlatformAdministration,useAdministrationQuery } from '@/state';
import { ReporterBrand } from '@/ui/reporter-brand';
import { useClientLinks } from '@/ui/shell/client-links';
import { SIDEBAR_COLLAPSED_KEY, usePersistentFlag } from '@/ui/shell/preference';
import { LOG_HREF, PEOPLE_HREF, PLATFORM_HREF, USAGE_HREF } from './format';

const PAGES = [
  { id: 'overview', label: 'Visão geral', icon: LayoutDashboard, href: PLATFORM_HREF },
  { id:'workspaces',label:'Workspaces',icon:Building2,href:'/platform/workspaces'},
  { id: 'people', label: 'Pessoas', icon: Users, href: PEOPLE_HREF },
  { id: 'usage', label: 'Uso', icon: ChartNoAxesColumn, href: USAGE_HREF },
  { id: 'log', label: 'Registro', icon: ScrollText, href: LOG_HREF },
] as const;

function activePage(pathname: string) {
  return [...PAGES].reverse().find((page) => pathname === page.href || pathname.startsWith(`${page.href}/`)) ?? PAGES[0];
}

function OperatorAccount() {
  const router = useRouter();
  const operator = usePlatformOperator().data;
  const demo = usePlatform().mode === 'demo';
  if (!operator) return null;
  return (
    <ThemeV3>
      <SidebarAccount
        name={operator.name}
        src={operator.avatarUrl}
        detail="Operador da plataforma"
        sections={demo ? [] : [{ label: 'Conta', items: [{ label: 'Sair', icon: LogOut, onSelect: () => { void authClient.signOut().finally(() => router.replace('/auth/sign-in')); } }] }]}
      />
    </ThemeV3>
  );
}

/**
 * The console's own frame: its four pages, the way back to the workspace, the operator's account,
 * and the trail "Plataforma › página". Pessoas counts the sign-ups waiting for release.
 */
export function PlatformShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  useClientLinks();
  const [collapsed, setCollapsed] = usePersistentFlag(SIDEBAR_COLLAPSED_KEY);
  const directory = usePlatformDirectory({status:'pending',limit:1}).data;
  const waiting = directory?.counts?.pending??directory?.people.filter(person=>person.status==='pending').length??0;
  const page = activePage(pathname);
  const workspaceId=/^\/platform\/workspaces\/([^/]+)$/.exec(pathname)?.[1],administration=usePlatformAdministration();
  const workspace=useAdministrationQuery(workspaceId?administration:undefined,`trail:${workspaceId}`,admin=>admin.get(workspaceId!));

  const groups = useMemo<NavGroup[]>(() => [{
    id: 'platform',
    label: 'Plataforma',
    items: PAGES.map((item) => {
      const nav: NavItem = { id: item.id, label: item.label, icon: item.icon, href: item.href };
      if (item.id === 'people' && waiting > 0) { nav.count = waiting; nav.countTone = 'accent'; }
      return nav;
    }),
  }], [waiting]);

  const onNavigate = useCallback((id: string, event: MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => {
    const href = PAGES.find((item) => item.id === id)?.href;
    if (!href || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    router.push(href);
  }, [router]);

  const crumbs = page.id === 'overview' ? [{ label: 'Plataforma' }] : [{ label: 'Plataforma', href: PLATFORM_HREF },
    { label: page.label,...(workspaceId?{href:page.href}:{}) },...(workspaceId?[{label:workspace.data?.name??'Workspace'}]:[])];

  return (
    <AppShell
      layout="auto"
      collapsed={collapsed}
      sidebar={(
        <Sidebar
          label="Menu da plataforma"
          product={<ReporterBrand endorsed />}
          groups={groups}
          utilities={[{ id: 'workspace', label: 'Abrir workspace', icon: ArrowUpRight, href: '/workspaces' }]}
          active={page.id}
          onNavigate={onNavigate}
          account={<OperatorAccount />}
        />
      )}
      topbar={<TopBar breadcrumb={crumbs} onToggleSidebar={() => setCollapsed(!collapsed)} actions={<Badge tone="gray" variant="outline">Console da plataforma</Badge>} />}
    >
      {children}
    </AppShell>
  );
}
