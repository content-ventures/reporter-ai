import type { Metadata } from "next";
import { ProductionsKanbanScreen } from "@/features/productions/productions-kanban";

export const metadata: Metadata = { title: "Produções" };

export default function ProductionsPage() {
  return <ProductionsKanbanScreen />;
}
