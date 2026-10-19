import type { Metadata } from 'next';
import { QuoteBankScreen } from '@/features/hard-news/quotes/quote-bank-screen';

export const metadata: Metadata = { title: 'Citações' };

/** Citações: the quote bank (R2), on the R1 citations in a connected build. */
export default function Page() {
  return <QuoteBankScreen />;
}
