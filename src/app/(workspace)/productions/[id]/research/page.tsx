import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ResearchScreen } from "@/features/hard-news/research/research-screen";
import { isReleased } from "@/registries";

export const metadata: Metadata = { title: "Apuração" };

/** R2 · Apuração of a covered news story. Before R2 the address answers 404, as any unknown stage. */
export default function ResearchPage() {
  if (!isReleased("R2")) notFound();
  return <ResearchScreen />;
}
