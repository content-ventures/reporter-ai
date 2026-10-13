import type { Metadata } from 'next';
import { ImagesScreen } from '@/features/images/images-screen';
export const metadata: Metadata = { title: 'Biblioteca de imagens' };
export default function ImagesPage() { return <ImagesScreen />; }
