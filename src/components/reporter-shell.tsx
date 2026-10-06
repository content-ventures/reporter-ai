"use client";

import type { ReactNode } from "react";
import {
  AppShell,
  ProductMark,
  Sidebar,
  TopBar,
  type NavGroup,
} from "@content-ventures/design-system/v3";
import {
  Archive,
  Database,
  LayoutDashboard,
  ListChecks,
  Palette,
} from "@content-ventures/design-system/v3/icons";

const navigation: NavGroup[] = [
  {
    id: "produto",
    label: "Produto",
    items: [
      {
        id: "overview",
        label: "Visão geral",
        icon: LayoutDashboard,
        href: "/#overview",
      },
      {
        id: "roadmap",
        label: "Sequência aprovada",
        icon: ListChecks,
        href: "/#roadmap",
      },
    ],
  },
  {
    id: "fundacao",
    label: "Fundação",
    items: [
      {
        id: "technical-base",
        label: "Base técnica",
        icon: Database,
        href: "/#technical-base",
      },
      {
        id: "design-system",
        label: "Design System",
        icon: Palette,
        href: "/#design-system",
      },
      {
        id: "versions",
        label: "Versões",
        icon: Archive,
        href: "/versions",
      },
    ],
  },
];

export function ReporterShell({
  active,
  breadcrumb,
  children,
}: {
  active: string;
  breadcrumb: string;
  children: ReactNode;
}) {
  return (
    <AppShell
      sidebar={
        <Sidebar
          label="Navegação do Reporter IA"
          product={<ProductMark name="Reporter IA" caption="Content Ventures" />}
          groups={navigation}
          active={active}
          footer="R0 · Fundação"
        />
      }
      topbar={
        <TopBar
          breadcrumb={[
            { label: "Content Ventures" },
            { label: "Reporter IA", href: "/" },
            { label: breadcrumb },
          ]}
        />
      }
    >
      {children}
    </AppShell>
  );
}
