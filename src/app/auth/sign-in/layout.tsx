import type { Metadata } from 'next';
import { PRODUCT_TITLE } from '@/lib/brand';
import { BRAND_OPEN_GRAPH, PUBLIC_INDEXING } from '@/lib/site';

export const metadata: Metadata = {
  title: { absolute: PRODUCT_TITLE },
  alternates: { canonical: '/auth/sign-in' },
  robots: { index: PUBLIC_INDEXING, follow: PUBLIC_INDEXING },
  openGraph: { ...BRAND_OPEN_GRAPH, url: '/auth/sign-in' },
};

export default function SignInLayout({ children }: LayoutProps<'/auth/sign-in'>) {
  return children;
}
