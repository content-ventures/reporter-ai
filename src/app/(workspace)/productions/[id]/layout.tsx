import type { Metadata } from "next";
import { ProductionFrame } from "@/features/production/production-frame";

// A nested layout keeps the root template only when it declares one itself.
export const metadata: Metadata = { title: { default: "Produção", template: "%s · Reporter IA" } };

export default async function ProductionLayout({ children, params }: LayoutProps<"/productions/[id]">) {
  const { id } = await params;
  return <ProductionFrame productionId={id}>{children}</ProductionFrame>;
}
