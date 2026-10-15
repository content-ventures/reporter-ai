import type { Metadata } from 'next';
import { ImagesScreen } from '@/features/images/images-screen';
import { R2ScreenContent } from '@/features/r2-prototype/r2-prototype';
import { R2_UI_PREVIEW } from '@/ui/r2-preview';
export const metadata: Metadata = { title: 'Biblioteca de imagens' };
export default function Page() { return R2_UI_PREVIEW ? <R2ScreenContent screen="images" /> : <ImagesScreen />; }
