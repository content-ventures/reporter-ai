import type { Metadata } from "next";
import { OverviewScreen } from "@/features/overview/overview-screen";

export const metadata: Metadata = { title: "Início" };

export default function OverviewPage() {
  return <OverviewScreen />;
}
