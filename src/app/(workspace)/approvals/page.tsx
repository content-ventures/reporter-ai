import type { Metadata } from "next";
import { ApprovalsScreen } from "@/features/approval/approvals-screen";

export const metadata: Metadata = { title: "Aprovações" };

export default function ApprovalsPage() {
  return <ApprovalsScreen />;
}
