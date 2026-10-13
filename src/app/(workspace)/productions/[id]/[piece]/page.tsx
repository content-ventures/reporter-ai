import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pieceKindBySlug } from "@/registries";
import { StudioRoute } from "@/features/studio/studio-route";

export async function generateMetadata({ params }: PageProps<"/productions/[id]/[piece]">): Promise<Metadata> {
  const { piece } = await params;
  return { title: pieceKindBySlug(piece)?.label ?? "Produção" };
}

export default async function PiecePage({ params }: PageProps<"/productions/[id]/[piece]">) {
  const { id, piece } = await params;
  const entry = pieceKindBySlug(piece);
  if (!entry) notFound();
  return <StudioRoute productionId={id} pieceKind={entry.kind} />;
}
