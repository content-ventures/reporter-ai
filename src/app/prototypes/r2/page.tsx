import { notFound, redirect } from 'next/navigation';
import { R2_ROUTES, R2_UI_PREVIEW, type R2Screen } from '@/ui/r2-preview';
/** Compatibility for the first review URL; there is no separate R2 application. */
export default async function Page({ searchParams }: { searchParams: Promise<{ screen?: string }> }) {
  if (!R2_UI_PREVIEW) notFound();
  const { screen } = await searchParams;
  redirect(screen && Object.hasOwn(R2_ROUTES, screen) ? R2_ROUTES[screen as R2Screen] : R2_ROUTES.news);
}
