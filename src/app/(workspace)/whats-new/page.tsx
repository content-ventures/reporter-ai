import type { Metadata } from "next";
import { WhatsNewScreen } from "@/features/whats-new/whats-new-screen";

export const metadata: Metadata = { title: "Versões" };

export default function WhatsNewPage() {
  return <WhatsNewScreen />;
}
