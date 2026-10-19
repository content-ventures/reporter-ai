import { redirect } from 'next/navigation';

/** The first review URL (`/prototypes/r2?screen=`) opens the matching workspace destination. */
const SCREENS: Record<string, string> = {
  news: '/news',
  'hard-news': '/news',
  images: '/images',
  quotes: '/quotes',
  archive: '/archive',
  'editorial-map': '/settings/editorial-map',
  'writing-guide': '/settings/writing-guide',
  cms: '/admin/integrations',
};

export default async function Page({ searchParams }: { searchParams: Promise<{ screen?: string }> }) {
  const { screen } = await searchParams;
  redirect(screen && Object.hasOwn(SCREENS, screen) ? SCREENS[screen] : SCREENS.news);
}
