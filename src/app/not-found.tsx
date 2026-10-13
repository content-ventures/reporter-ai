import type { Metadata } from "next";
import { NotFoundState } from "@/features/common/not-found-state";

export const metadata: Metadata = { title: "Página não encontrada" };

export default function NotFound() {
  return <NotFoundState />;
}
