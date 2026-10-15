import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { R2ScreenContent } from '@/features/r2-prototype/r2-prototype';
import { R2_UI_PREVIEW } from '@/ui/r2-preview';
export const metadata: Metadata = { title: 'Hard News' };
export default function Page() {
  if (!R2_UI_PREVIEW) notFound();
  return <R2ScreenContent screen="hard-news" />;
}
