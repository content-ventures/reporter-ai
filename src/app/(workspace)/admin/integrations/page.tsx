import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { R2ScreenContent } from '@/features/r2-prototype/r2-prototype';
import { IntegrationsScreen } from '@/features/hard-news/integrations/integrations-screen';
import { isReleased } from '@/registries';
import { R2_UI_PREVIEW } from '@/ui/r2-preview';
export const metadata: Metadata = { title: isReleased('R2') ? 'Integrações' : 'CMS do portal' };
export default function Page() {
  if (isReleased('R2')) return <IntegrationsScreen />;
  if (!R2_UI_PREVIEW) notFound();
  return <R2ScreenContent screen="cms" />;
}
