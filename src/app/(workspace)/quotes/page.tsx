import type { Metadata } from 'next';
import { CitationsScreen } from '@/features/citations/citations-screen';
import { R2ScreenContent } from '@/features/r2-prototype/r2-prototype';
import { QuoteBankScreen } from '@/features/hard-news/quotes/quote-bank-screen';
import { isReleased } from '@/registries';
import { R2_UI_PREVIEW } from '@/ui/r2-preview';
export const metadata: Metadata = { title: 'Citações' };
export default function Page() {
  if (isReleased('R2')) return <QuoteBankScreen />;
  return R2_UI_PREVIEW ? <R2ScreenContent screen="quotes" /> : <CitationsScreen />;
}
