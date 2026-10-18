import { WorkspaceShell } from "@/ui/shell";
import { RuntimeProvider } from '@/state';
import { PrototypeProvider } from '@/features/r2-prototype/prototype-state';
import { HardNewsProvider } from '@/features/hard-news/state/hard-news-provider';
import { isReleased } from '@/registries';
import { R2_UI_PREVIEW } from '@/ui/r2-preview';

export default function WorkspaceLayout({ children }: LayoutProps<"/">) {
  if (isReleased('R2')) {
    return <RuntimeProvider><HardNewsProvider><WorkspaceShell>{children}</WorkspaceShell></HardNewsProvider></RuntimeProvider>;
  }
  const content = <WorkspaceShell>{children}</WorkspaceShell>;
  return <RuntimeProvider>{R2_UI_PREVIEW ? <PrototypeProvider>{content}</PrototypeProvider> : content}</RuntimeProvider>;
}
