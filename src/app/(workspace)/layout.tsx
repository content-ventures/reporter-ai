import { WorkspaceShell } from "@/ui/shell";
import { RuntimeProvider } from '@/state';

export default function WorkspaceLayout({ children }: LayoutProps<"/">) {
  return <RuntimeProvider><WorkspaceShell>{children}</WorkspaceShell></RuntimeProvider>;
}
