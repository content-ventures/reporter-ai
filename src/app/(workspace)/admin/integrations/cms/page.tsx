import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CmsScreen } from '@/features/hard-news/integrations/cms-screen';
import { isReleased } from '@/registries';

export const metadata: Metadata = { title: 'WordPress' };

/** R2 · WordPress, the portal's CMS. Before R2 the address answers 404. */
export default function Page() {
  if (!isReleased('R2')) notFound();
  return <CmsScreen />;
}
