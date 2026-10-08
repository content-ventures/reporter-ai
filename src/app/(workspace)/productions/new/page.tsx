import type { Metadata } from "next";
import { NewProductionScreen } from "@/features/new-production/new-production-screen";

export const metadata: Metadata = { title: "Nova produção" };

export default function NewProductionPage() {
  return <NewProductionScreen />;
}
