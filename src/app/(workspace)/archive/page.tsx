import type { Metadata } from 'next';
import { ArchiveScreen } from '@/features/hard-news/archive/archive-screen';

export const metadata: Metadata = { title: 'Acervo' };

/** Acervo (R2), a demonstration in an R1 build. */
export default function Page() {
  return <ArchiveScreen />;
}
