import type { Metadata } from "next";
import { DeliveryScreen } from "@/features/delivery/delivery-screen";

export const metadata: Metadata = { title: "Entrega" };

export default async function DeliveryPage({ params }: PageProps<"/productions/[id]/delivery">) {
  const { id } = await params;
  return <DeliveryScreen productionId={id} />;
}
