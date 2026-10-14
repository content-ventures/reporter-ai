import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NewProductionScreen } from "@/features/new-production/new-production-screen";
import { pieceHref } from "@/ui/routes";

export const metadata: Metadata = { title: "Nova produção" };

/** Old structure URLs open the saved article in its editor. */
export default async function NewProductionPage({ searchParams }: PageProps<"/productions/new">) {
  const { producao } = await searchParams;
  if (typeof producao === "string" && producao) redirect(pieceHref(producao, "article"));
  return <NewProductionScreen />;
}
