import type { Metadata } from "next";
import { WhatsNewScreen } from "@/features/whats-new/whats-new-screen";

export const metadata: Metadata = { title: "Novidades" };

export default function WhatsNewPage() {
  return <WhatsNewScreen />;
}
