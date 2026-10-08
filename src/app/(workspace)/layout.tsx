import { WorkspaceShell } from "@/ui/shell";

export default function WorkspaceLayout({ children }: LayoutProps<"/">) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
