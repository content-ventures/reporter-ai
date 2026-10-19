import type { Metadata } from 'next';
import { EditorialMapScreen } from '@/features/hard-news/settings/editorial-map-screen';

export const metadata: Metadata = { title: 'Mapa editorial' };

/** Mapa editorial (R2), a demonstration in an R1 build. */
export default function Page() {
  return <EditorialMapScreen />;
}
