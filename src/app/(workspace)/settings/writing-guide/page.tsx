import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { R2ScreenContent } from '@/features/r2-prototype/r2-prototype';
import { WritingGuideScreen } from '@/features/hard-news/settings/writing-guide-screen';
import { isReleased } from '@/registries';
import { R2_UI_PREVIEW } from '@/ui/r2-preview';
export const metadata: Metadata = { title: 'Guia de escrita' };
export default function Page() {
  if (isReleased('R2')) return <WritingGuideScreen />;
  if (!R2_UI_PREVIEW) notFound();
  return <R2ScreenContent screen="writing-guide" />;
}
