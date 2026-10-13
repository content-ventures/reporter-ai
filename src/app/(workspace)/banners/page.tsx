import type { Metadata } from 'next';
import { BannersScreen } from '@/features/banners/banners-screen';
export const metadata: Metadata = { title: 'Estúdio de banners' };
export default function BannersPage() { return <BannersScreen />; }
