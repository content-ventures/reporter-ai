import type { Metadata } from 'next';
import { CmsScreen } from '@/features/hard-news/integrations/cms-screen';

export const metadata: Metadata = { title: 'WordPress' };

/** R2 · WordPress, the portal's CMS. A demonstration in an R1 build. */
export default function Page() {
  return <CmsScreen />;
}
