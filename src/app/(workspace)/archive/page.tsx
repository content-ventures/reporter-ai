import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArchiveScreen } from '@/features/hard-news/archive/archive-screen';
import { R2ScreenContent } from '@/features/r2-prototype/r2-prototype';
import { isReleased } from '@/registries';
import { R2_UI_PREVIEW } from '@/ui/r2-preview';
export const metadata: Metadata = { title: 'Acervo' };
export default function Page() {
  if (isReleased('R2')) return <ArchiveScreen />;
  if (!R2_UI_PREVIEW) notFound();
  return <R2ScreenContent screen="archive" />;
}
