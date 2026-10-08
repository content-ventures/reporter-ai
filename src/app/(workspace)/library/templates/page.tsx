import type { Metadata } from "next";
import { TemplatesScreen } from "@/features/library/templates-screen";

export const metadata: Metadata = { title: "Modelos" };

export default function TemplatesPage() {
  return <TemplatesScreen />;
}
