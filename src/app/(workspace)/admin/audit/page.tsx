import type { Metadata } from "next";
import { AuditScreen } from "@/features/audit/audit-screen";

export const metadata: Metadata = { title: "Logs" };

export default function AuditPage() {
  return <AuditScreen />;
}
