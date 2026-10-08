import type { Metadata } from "next";
import { WorkspaceShell } from "@/ui/shell";
import { NotFoundState } from "@/features/common/not-found-state";

export const metadata: Metadata = { title: "Página não encontrada" };

export default function NotFound() {
  return (
    <WorkspaceShell>
      <NotFoundState />
    </WorkspaceShell>
  );
}
