import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ImageBank, ImageBankFromUrl } from '@/features/hard-news/images/image-bank-screen';
import { ImagesScreen } from '@/features/images/images-screen';
import { R2ScreenContent } from '@/features/r2-prototype/r2-prototype';
import { isReleased } from '@/registries';
import { R2_UI_PREVIEW } from '@/ui/r2-preview';
export const metadata: Metadata = { title: 'Biblioteca de imagens' };
export default function Page() {
  if (isReleased('R2')) return <Suspense fallback={<ImageBank />}><ImageBankFromUrl /></Suspense>;
  return R2_UI_PREVIEW ? <R2ScreenContent screen="images" /> : <ImagesScreen />;
}
