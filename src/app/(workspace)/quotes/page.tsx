import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeader, PageStack, Spinner } from '@content-ventures/design-system/v3';
import { MemoryLibraryScreen } from '@/features/editorial-memory/memory-library-screen';
import { QuoteBankScreen } from '@/features/hard-news/quotes/quote-bank-screen';

export const metadata: Metadata = { title: 'Citações' };

/** Citações: the quote bank (R2), on the R1 citations in a connected build. */
export default function Page() {
  return process.env.REPORTER_MEMORY_MODE === 'on' ? <Suspense fallback={<PageStack><PageHeader title="Banco de citações e estatísticas" /><Spinner label="Carregando evidências" /></PageStack>}><MemoryLibraryScreen /></Suspense> : <QuoteBankScreen />;
}
