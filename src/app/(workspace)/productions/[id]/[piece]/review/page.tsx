import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pieceKindBySlug } from "@/registries";
import { stageCrumbLabel } from "@/features/production/trail";
import { ReviewScreen } from "@/features/review/review-screen";

/** The tab names the stage as the trail does ("Aprovação do artigo"), on the server too. */
export async function generateMetadata({ params }: PageProps<"/productions/[id]/[piece]/review">): Promise<Metadata> {
  const { piece } = await params;
  const entry = pieceKindBySlug(piece);
  return { title: (entry ? stageCrumbLabel({ kind: "review", pieceKind: entry.kind }) : undefined) ?? "Aprovação" };
}

export default async function ReviewPage({ params }: PageProps<"/productions/[id]/[piece]/review">) {
  const { id, piece } = await params;
  const entry = pieceKindBySlug(piece);
  if (!entry?.gateId) notFound();
  return <ReviewScreen productionId={id} pieceKind={entry.kind} />;
}
