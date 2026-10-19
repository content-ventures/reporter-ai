import type { Metadata } from 'next';
import { OverviewScreen } from '@/features/platform/overview-screen';

export const metadata: Metadata = { title: 'Plataforma' };

export default function PlatformPage() {
  return <OverviewScreen />;
}
