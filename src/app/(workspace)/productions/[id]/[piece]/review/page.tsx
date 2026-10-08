import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pieceKindBySlug } from "@/registries";
import { ReviewScreen } from "@/features/review/review-screen";

export const metadata: Metadata = { title: "Revisão" };

export default async function ReviewPage({ params }: PageProps<"/productions/[id]/[piece]/review">) {
  const { id, piece } = await params;
  const entry = pieceKindBySlug(piece);
  if (!entry?.gateId) notFound();
  return <ReviewScreen productionId={id} pieceKind={entry.kind} />;
}
