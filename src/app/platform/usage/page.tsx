import type { Metadata } from 'next';
import { UsageScreen } from '@/features/platform/usage-screen';

export const metadata: Metadata = { title: 'Uso · Plataforma' };

export default function PlatformUsagePage() {
  return <UsageScreen />;
}
