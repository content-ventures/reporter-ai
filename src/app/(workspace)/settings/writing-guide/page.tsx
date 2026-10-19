import type { Metadata } from 'next';
import { WritingGuideScreen } from '@/features/hard-news/settings/writing-guide-screen';

export const metadata: Metadata = { title: 'Guia de escrita' };

/** Guia de escrita (R2), a demonstration in an R1 build. */
export default function Page() {
  return <WritingGuideScreen />;
}
