import type { MetadataRoute } from 'next';
import { PUBLIC_INDEXING, SITE_URL } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_INDEXING ? [{ url: new URL('/auth/sign-in', SITE_URL).href }] : [];
}
