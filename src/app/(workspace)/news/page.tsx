import { Suspense } from 'react';
import type { Metadata } from 'next';
import { NewsDesk, NewsDeskFromUrl } from '@/features/hard-news/news/news-desk';

export const metadata: Metadata = { title: 'Notícias' };

/** Notícias: the news radar (R2), a demonstration in an R1 build. */
export default function Page() {
  return <Suspense fallback={<NewsDesk />}><NewsDeskFromUrl /></Suspense>;
}
