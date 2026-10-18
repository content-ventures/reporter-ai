import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PhotoScreen, PhotoScreenFromUrl } from '@/features/hard-news/images/photo-screen';
import { isReleased } from '@/registries';

export const metadata: Metadata = { title: 'Imagem' };

/** R2 · the page of one photo of the image bank. Before R2 the address answers 404, as any unknown page. */
export default function PhotoPage() {
  if (!isReleased('R2')) notFound();
  return <Suspense fallback={<PhotoScreen />}><PhotoScreenFromUrl /></Suspense>;
}
