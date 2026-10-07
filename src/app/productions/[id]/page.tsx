import { ProductionWorkspace } from "@/components/production-workspace";

export default async function ProductionPage({ params }: PageProps<"/productions/[id]">) {
  const { id } = await params;
  return <ProductionWorkspace id={id} />;
}
