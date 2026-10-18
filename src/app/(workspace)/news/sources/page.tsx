import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SourcesScreen } from '@/features/hard-news/sources/sources-screen';
import { isReleased } from '@/registries';
export const metadata: Metadata = { title: 'Fontes' };
export default function Page() {
  if (!isReleased('R2')) notFound();
  return <SourcesScreen />;
}
