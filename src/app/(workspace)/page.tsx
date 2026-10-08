import type { Metadata } from "next";
import { OverviewScreen } from "@/features/overview/overview-screen";

export const metadata: Metadata = { title: "Visão geral" };

export default function OverviewPage() {
  return <OverviewScreen />;
}
