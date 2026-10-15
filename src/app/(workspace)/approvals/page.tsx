import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Produções" };

export default function ApprovalsPage() {
  redirect("/productions");
}
