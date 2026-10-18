import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { R2ScreenContent } from '@/features/r2-prototype/r2-prototype';
import { EditorialMapScreen } from '@/features/hard-news/settings/editorial-map-screen';
import { isReleased } from '@/registries';
import { R2_UI_PREVIEW } from '@/ui/r2-preview';
export const metadata: Metadata = { title: 'Mapa editorial' };
export default function Page() {
  if (isReleased('R2')) return <EditorialMapScreen />;
  if (!R2_UI_PREVIEW) notFound();
  return <R2ScreenContent screen="editorial-map" />;
}
