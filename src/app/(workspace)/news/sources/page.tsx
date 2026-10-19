import type { Metadata } from 'next';
import { SourcesScreen } from '@/features/hard-news/sources/sources-screen';

export const metadata: Metadata = { title: 'Fontes' };

/** Fontes of the news radar (R2), a demonstration in an R1 build. */
export default function Page() {
  return <SourcesScreen />;
}
