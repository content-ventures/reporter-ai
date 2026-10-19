import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PhotoScreen, PhotoScreenFromUrl } from '@/features/hard-news/images/photo-screen';

export const metadata: Metadata = { title: 'Imagem' };

/** R2 · the page of one photo of the image bank. A demonstration in an R1 build. */
export default function PhotoPage() {
  return <Suspense fallback={<PhotoScreen />}><PhotoScreenFromUrl /></Suspense>;
}
