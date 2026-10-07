"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  AppShell,
  CommandPalette,
  NotificationsButton,
  ProductMark,
  Sidebar,
  SidebarAccount,
  SidebarSearch,
  TopBar,
  toast,
  type CommandGroup,
  type MenuSection,
  type NavGroup,
  type NavItem,
} from "@content-ventures/design-system/v3";
import {
  FileText,
  LayoutDashboard,
  LogOut,
  Plus,
  Settings2,
  Sparkles,
  UserRound,
} from "@content-ventures/design-system/v3/icons";
import { stages } from "@/data/editorial-demo";
import { useEditorial } from "@/components/editorial-provider";

const navigation: NavGroup[] = [
  {
    id: "editorial",
    label: "Produção editorial",
    items: [
      { id: "overview", label: "Visão geral", icon: LayoutDashboard, href: "/" },
      { id: "productions", label: "Produções", icon: FileText, href: "/productions" },
    ],
  },
];

const utilities: NavItem[] = [
  { id: "versions", label: "Novidades", icon: Sparkles, href: "/versions" },
];

const navigationItems = navigation.flatMap((group) => group.items);
const allItems = [...navigationItems, ...utilities];

export function ReporterShell({
  active,
  breadcrumb,
  children,
  focused = false,
}: {
  active: string;
  breadcrumb: string;
  children: ReactNode;
  focused?: boolean;
}) {
  const router = useRouter();
  const { productions } = useEditorial();
  const [collapsed, setCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);

  const commandGroups = useMemo<CommandGroup[]>(
    () => [
      ...navigation.map((group) => ({
        label: "Navegação",
        showWhenEmpty: false,
        items: group.items.map((item) => ({
          id: item.id,
          label: item.label,
          icon: item.icon,
          keywords: group.label,
          onSelect: () => item.href && router.push(item.href),
        })),
      })),
      {
        label: "Produções",
        showWhenEmpty: false,
        items: productions.map((production) => ({
          id: `production-${production.id}`,
          label: production.title,
          description: stages.find((stage) => stage.id === production.stage)?.label,
          icon: FileText,
          keywords: `${production.owner} ${production.source}`,
          onSelect: () => router.push(`/productions/${production.id}`),
        })),
      },
    ],
    [productions, router],
  );

  const recentCommands = useMemo(
    () => [
      {
        id: "new-production",
        label: "Nova produção",
        description: "Transcrição, artigo e carrossel",
        icon: Plus,
        onSelect: () => router.push("/productions/new"),
      },
      ...productions.slice(0, 3).map((production) => ({
        id: `recent-${production.id}`,
        label: production.title,
        description: stages.find((stage) => stage.id === production.stage)?.label,
        icon: FileText,
        onSelect: () => router.push(`/productions/${production.id}`),
      })),
    ],
    [productions, router],
  );

  const accountSections: MenuSection[] = [
    {
      label: "Conta",
      items: [
        { label: "Meu perfil", icon: UserRound, onSelect: () => toast("Perfil em modo de demonstração", { tone: "info" }) },
        { label: "Preferências", icon: Settings2, onSelect: () => toast("Preferências em modo de demonstração", { tone: "info" }) },
      ],
    },
    { items: [{ label: "Sair", icon: LogOut, onSelect: () => toast("Sessão de demonstração", { tone: "info" }) }] },
  ];

  const reviewProductions = productions
    .filter((production) => production.stage === "article" || production.stage === "carousel")
    .slice(0, 3);
  const notificationSections: MenuSection[] = [
    {
      label: "Revisões",
      items: reviewProductions.map((production) => ({
        label: production.stage === "article" ? "Artigo aguardando revisão" : "Carrossel aguardando revisão",
        description: production.title,
        meta: production.updated,
        onSelect: () => router.push(`/productions/${production.id}`),
      })),
    },
  ];

  return (
    <>
      <AppShell
        collapsed={collapsed}
        layout={focused ? "drawer" : "auto"}
        sidebar={
          !focused && (
            <Sidebar
              label="Navegação do Reporter IA"
              product={<ProductMark name="Reporter IA" caption="Content Ventures" />}
              search={<SidebarSearch onOpen={() => setCommandOpen(true)} bindShortcut label="Busca rápida" />}
              groups={navigation}
              active={active}
              onNavigate={(id, event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                const item = allItems.find((candidate) => candidate.id === id);
                if (!item?.href) return;
                event.preventDefault();
                router.push(item.href);
              }}
              utilities={utilities}
              account={
                <SidebarAccount
                  name="João Vitor"
                  detail="Editor · Content Ventures"
                  presence="online"
                  sections={accountSections}
                />
              }
            />
          )
        }
        topbar={
          !focused && (
            <TopBar
              breadcrumb={[
                { label: "Reporter IA", onClick: () => router.push("/") },
                { label: breadcrumb },
              ]}
              onToggleSidebar={() => setCollapsed((value) => !value)}
              notifications={
                <NotificationsButton count={reviewProductions.length} sections={notificationSections} />
              }
              maxCrumbs={3}
            />
          )
        }
      >
        {children}
      </AppShell>
      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        groups={commandGroups}
        recent={recentCommands}
        placeholder="Buscar páginas, produções e módulos"
        label="Busca rápida do Reporter IA"
      />
    </>
  );
}
