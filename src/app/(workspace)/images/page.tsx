import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ImageBank, ImageBankFromUrl } from '@/features/hard-news/images/image-bank-screen';

export const metadata: Metadata = { title: 'Biblioteca de imagens' };

/** Imagens: the image bank (R2), on the R1 visual library in a connected build. */
export default function Page() {
  return <Suspense fallback={<ImageBank />}><ImageBankFromUrl /></Suspense>;
}
