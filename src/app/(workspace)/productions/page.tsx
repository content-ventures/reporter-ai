import type { Metadata } from "next";
import { ProductionsScreen } from "@/features/productions/productions-screen";

export const metadata: Metadata = { title: "Produções" };

export default function ProductionsPage() {
  return <ProductionsScreen />;
}
