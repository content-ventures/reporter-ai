import type { Metadata } from 'next';
import { LogScreen } from '@/features/platform/log-screen';

export const metadata: Metadata = { title: 'Registro · Plataforma' };

export default function PlatformLogPage() {
  return <LogScreen />;
}
