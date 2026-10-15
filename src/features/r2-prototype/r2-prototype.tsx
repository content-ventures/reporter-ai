'use client';
import { useRouter } from 'next/navigation';
import { AccessState, PageHeader, PageStack } from '@content-ventures/design-system/v3';
import { useSession } from '@/state';
import { useBreadcrumb } from '@/ui/shell';
import { R2_ROUTES, type R2Screen } from '@/ui/r2-preview';
import { NewsScreen } from './news-screen';
import { EditorialSettings } from './editorial-settings';
import { LibraryScreen } from './library-screen';
import { CmsScreen } from './cms-screen';
import { HardNewsScreen } from './hard-news-screen';

export type { R2Screen } from '@/ui/r2-preview';
export type R2Navigate = (screen: R2Screen) => void;
/** R2 screens share the existing workspace shell and session-local demonstration provider. */
export function R2ScreenContent({ screen }: { screen: R2Screen }) {
  const router = useRouter();
  const session = useSession();
  const navigate: R2Navigate = destination => router.push(R2_ROUTES[destination]);
  useBreadcrumb(screen === 'hard-news' ? [{ label: 'Notícias', href: R2_ROUTES.news }, { label: 'Hard News' }] : undefined);
  if (screen === 'cms') {
    if (session.status === 'loading') return <PageStack><PageHeader title="CMS do portal" /></PageStack>;
    if (!session.data?.current?.roles.includes('admin')) return <AccessState kind="restricted" heading="h1" title="CMS restrito a administradores" />;
    return <CmsScreen />;
  }
  if (screen === 'news') return <NewsScreen navigate={navigate} />;
  if (screen === 'hard-news') return <HardNewsScreen navigate={navigate} />;
  if (screen === 'images' || screen === 'quotes' || screen === 'archive') return <LibraryScreen key={screen} kind={screen} navigate={navigate} />;
  return <EditorialSettings key={screen} kind={screen} />;
}
