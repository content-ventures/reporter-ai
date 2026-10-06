import type { Metadata } from "next";
import { VersionHistory } from "@/components/version-history";

export const metadata: Metadata = {
  title: "Versões · Reporter IA",
  description: "Histórico de versões e releases do Reporter IA.",
};

export default function VersionsPage() {
  return <VersionHistory />;
}
