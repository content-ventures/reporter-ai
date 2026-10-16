import 'server-only';
import type { Metadata } from 'next';
import { PRODUCT_DESCRIPTION, PRODUCT_NAME, PRODUCT_TITLE } from './brand';

// Prefer the stable production domain, never an ephemeral Preview URL.
export const SITE_URL = new URL(process.env.REPORTER_APP_URL?.trim()
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000'));
export const PUBLIC_INDEXING = process.env.VERCEL_ENV === 'production';

export const BRAND_SHARE_IMAGE = {
  url: '/opengraph-image.png', width: 1200, height: 630,
  alt: 'Reporter AI — Da fonte à publicação. Powered by Content Ventures.',
};

export const BRAND_OPEN_GRAPH: Metadata['openGraph'] = {
  type: 'website', locale: 'pt_BR', siteName: PRODUCT_NAME,
  title: PRODUCT_TITLE, description: PRODUCT_DESCRIPTION,
  images: [BRAND_SHARE_IMAGE],
};
