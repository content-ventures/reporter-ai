import { ProductionIndex } from "@/features/production/production-index";

export default async function ProductionPage({ params }: PageProps<"/productions/[id]">) {
  const { id } = await params;
  return <ProductionIndex productionId={id} />;
}
