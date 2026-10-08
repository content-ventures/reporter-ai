import type { Metadata } from "next";
import { NewProductionScreen } from "@/features/new-production/new-production-screen";

export const metadata: Metadata = { title: "Nova produção" };

/** `?producao={id}` opens step 3 (Estrutura) of a production that already exists (reload-safe). */
export default async function NewProductionPage({ searchParams }: PageProps<"/productions/new">) {
  const { producao } = await searchParams;
  return <NewProductionScreen productionId={typeof producao === "string" && producao ? producao : undefined} />;
}
