import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { R2ScreenContent } from '@/features/r2-prototype/r2-prototype';
import { NewsDesk, NewsDeskFromUrl } from '@/features/hard-news/news/news-desk';
import { isReleased } from '@/registries';
import { R2_UI_PREVIEW } from '@/ui/r2-preview';
export const metadata: Metadata = { title: 'Notícias' };
export default function Page() {
  if (isReleased('R2')) return <Suspense fallback={<NewsDesk />}><NewsDeskFromUrl /></Suspense>;
  if (!R2_UI_PREVIEW) notFound();
  return <R2ScreenContent screen="news" />;
}
