import type { Metadata } from 'next';
import { IntegrationsScreen } from '@/features/hard-news/integrations/integrations-screen';

export const metadata: Metadata = { title: 'Integrações' };

/** Integrações (R2), a demonstration in an R1 build. */
export default function Page() {
  return <IntegrationsScreen />;
}
