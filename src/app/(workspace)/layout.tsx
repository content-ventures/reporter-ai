import { WorkspaceShell } from "@/ui/shell";
import { RuntimeProvider } from '@/state';
import { PrototypeProvider } from '@/features/r2-prototype/prototype-state';
import { R2_UI_PREVIEW } from '@/ui/r2-preview';

export default function WorkspaceLayout({ children }: LayoutProps<"/">) {
  const content = <WorkspaceShell>{children}</WorkspaceShell>;
  return <RuntimeProvider>{R2_UI_PREVIEW ? <PrototypeProvider>{content}</PrototypeProvider> : content}</RuntimeProvider>;
}
