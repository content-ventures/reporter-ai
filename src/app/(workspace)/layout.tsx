import { WorkspaceShell } from "@/ui/shell";
import { RuntimeProvider } from '@/state';
import { HardNewsProvider } from '@/features/hard-news/state/hard-news-provider';
import { HARD_NEWS_DEMO } from '@/ui/r2-preview';

/** The Hard News desk is in every build: the release in an R2 build, a demonstration in an R1 build. */
export default function WorkspaceLayout({ children }: LayoutProps<"/">) {
  return <RuntimeProvider><HardNewsProvider demo={HARD_NEWS_DEMO}><WorkspaceShell>{children}</WorkspaceShell></HardNewsProvider></RuntimeProvider>;
}
