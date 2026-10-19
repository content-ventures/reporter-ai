import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { AppScreen } from '@/features/hard-news/integrations/app-screen';
import { appDef } from '@/features/hard-news/integrations/integrations-model';

export async function generateMetadata({ params }: PageProps<'/admin/integrations/[app]'>): Promise<Metadata> {
  const { app } = await params;
  return { title: appDef(app)?.name ?? 'Integração' };
}

/**
 * R2 · one app of the Integrações catalog: its connection, or the guided connection. WordPress
 * keeps its CMS page and the RSS feeds are the desk's Fontes; apps of a later release have no page
 * yet. A demonstration in an R1 build.
 */
export default async function Page({ params }: PageProps<'/admin/integrations/[app]'>) {
  const { app } = await params;
  const def = appDef(app);
  if (!def || def.since) notFound();
  if (def.id === 'wordpress') redirect('/admin/integrations/cms');
  if (def.id === 'rss') redirect('/news/sources');
  return <AppScreen id={def.id} />;
}
