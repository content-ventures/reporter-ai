import { WorkspaceShell } from "@/ui/shell";
import { RuntimeProvider } from '@/state';
import { HardNewsProvider } from '@/features/hard-news/state/hard-news-provider';
import { HARD_NEWS_DEMO } from '@/ui/r2-preview';
import {headers} from 'next/headers';
import {WORKSPACE_PAGE_HEADER} from '@/domain/workspace-address';

/** The Hard News desk is in every build: the release in an R2 build, a demonstration in an R1 build. */
export default async function WorkspaceLayout({ children }: LayoutProps<"/">) {
  const slug=(await headers()).get(WORKSPACE_PAGE_HEADER)??undefined;
  return <RuntimeProvider initialWorkspaceSlug={slug}><HardNewsProvider demo={HARD_NEWS_DEMO}><WorkspaceShell>{children}</WorkspaceShell></HardNewsProvider></RuntimeProvider>;
}
