import type { Metadata } from "next";
import { MaterialScreen } from "@/features/material/material-screen";

export const metadata: Metadata = { title: "Material" };

export default async function MaterialPage({ params }: PageProps<"/productions/[id]/source">) {
  const { id } = await params;
  return <MaterialScreen productionId={id} />;
}
